import * as esbuild from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

/**
 * The SDK reaches for `node:fs` / `node:path` only when resolving on-disk OAuth
 * profiles — a path it short-circuits out of before importing, because there is no
 * config root in a browser. esbuild still has to resolve the dynamic imports, so
 * stub them with modules that throw loudly if that assumption ever stops holding.
 */
const stubNodeBuiltins = {
  name: 'stub-node-builtins',
  setup(build) {
    const builtins = /^node:(fs|path|os|crypto|stream|util|url|buffer|fs\/promises)$/;
    build.onResolve({ filter: builtins }, (args) => ({ path: args.path, namespace: 'node-stub' }));
    build.onLoad({ filter: /.*/, namespace: 'node-stub' }, (args) => ({
      contents: `const unavailable = () => {
        throw new Error(${JSON.stringify('')} + '${args.path} is not available in the browser build');
      };
      export const promises = new Proxy({}, { get: unavailable });
      export default new Proxy({}, { get: unavailable });
      export const existsSync = unavailable, readFileSync = unavailable, writeFileSync = unavailable;
      export const join = unavailable, dirname = unavailable, resolve = unavailable;
      export const homedir = unavailable;`,
      loader: 'js',
    }));
  },
};

const watch = process.argv.includes('--watch');
const outdir = 'dist';

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const options = {
  entryPoints: {
    'background/service-worker': 'src/background/service-worker.ts',
    'sidepanel/sidepanel': 'src/sidepanel/sidepanel.ts',
    'options/options': 'src/options/options.ts',
    'preview/preview': 'src/preview/preview.ts',
  },
  outdir,
  bundle: true,
  format: 'esm',
  target: 'chrome116',
  platform: 'browser',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
  plugins: [stubNodeBuiltins],
  // The SDK ships Node shims it never reaches in a browser build; keep the
  // bundle honest by failing loudly instead of silently polyfilling.
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
};

async function copyStatic() {
  await cp('manifest.json', `${outdir}/manifest.json`);
  await cp('public/icons', `${outdir}/icons`, { recursive: true });
  await cp('src/sidepanel/index.html', `${outdir}/sidepanel/index.html`);
  await cp('src/sidepanel/sidepanel.css', `${outdir}/sidepanel/sidepanel.css`);
  await cp('src/options/index.html', `${outdir}/options/index.html`);
  await cp('src/options/options.css', `${outdir}/options/options.css`);
  await cp('src/preview/index.html', `${outdir}/preview/index.html`);
  await cp('src/preview/preview.css', `${outdir}/preview/preview.css`);
}

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  await copyStatic();
  console.log('watching…');
} else {
  await esbuild.build(options);
  await copyStatic();
  console.log(`built -> ${outdir}/`);
}
