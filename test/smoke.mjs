/**
 * Loads the built extension in Chromium and exercises everything that does not
 * need a live API key: the scraper against real DOM, the message protocol, the
 * renderer, and all three extension pages.
 *
 *   npm run build && node test/smoke.mjs
 *
 * Note: chrome.* bindings are not exposed to Playwright's service-worker
 * evaluation world, so the extension APIs are driven from a real extension page
 * (which round-trips through the service worker anyway — a truer test).
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const distPath = resolve(here, '..', 'dist');
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let failures = 0;
const check = (name, condition, detail = '') => {
  if (condition) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

// Serve the fixtures over http so the scraper runs against a realistic origin.
const server = createServer(async (req, res) => {
  try {
    const body = await readFile(resolve(here, 'fixtures', req.url.replace(/^\//, '').split('?')[0]));
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// Bundle the scraper so the test exercises the same source the extension ships.
const bundled = await esbuild.build({
  entryPoints: [resolve(here, '..', 'src', 'content', 'scrape.ts')],
  bundle: true, format: 'esm', write: false, target: 'es2022',
});
const { scrapeJobDescription } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

const userDataDir = await mkdtemp(join(tmpdir(), 'resume-tailor-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  executablePath: CHROMIUM,
  args: [`--disable-extensions-except=${distPath}`, `--load-extension=${distPath}`],
});

const pageErrors = [];

try {
  console.log('\nextension registration');
  let workers = context.serviceWorkers();
  if (!workers.length) {
    await context.waitForEvent('serviceworker', { timeout: 15_000 });
    workers = context.serviceWorkers();
  }
  const extensionId = new URL(workers[0].url()).host;
  check('service worker started', Boolean(extensionId), workers[0].url());

  const newExtensionPage = async (path) => {
    const p = await context.newPage();
    p.on('pageerror', (e) => pageErrors.push(`${path}: ${e.message}`));
    p.on('console', (m) => m.type() === 'error' && pageErrors.push(`${path}: ${m.text()}`));
    await p.goto(`chrome-extension://${extensionId}/${path}`);
    return p;
  };

  // A driver page gives us the chrome.* surface the worker evaluation world lacks.
  const driver = await newExtensionPage('options/index.html');
  const apis = await driver.evaluate(() => ({
    sidePanel: typeof chrome.sidePanel?.setPanelBehavior === 'function',
    scripting: typeof chrome.scripting?.executeScript === 'function',
    storage: typeof chrome.storage?.local?.get === 'function',
    permissions: typeof chrome.permissions?.request === 'function',
  }));
  check('sidePanel API available', apis.sidePanel);
  check('scripting API available', apis.scripting);
  check('storage API available', apis.storage);
  check('permissions API available', apis.permissions);

  console.log('\nmessage protocol');
  const send = (msg) =>
    driver.evaluate((m) => new Promise((r) => chrome.runtime.sendMessage(m, r)), msg);

  const ping = await send({ type: 'ping' });
  check('ping reaches the service worker', ping?.ok === true, JSON.stringify(ping));
  check('ping reports no key on a fresh profile', ping?.data?.hasKey === false);
  check('ping reports the default model', ping?.data?.model === 'claude-opus-5', ping?.data?.model);

  const noKey = await send({ type: 'tailor', jobDescription: 'x'.repeat(300), jobUrl: '', notes: '' });
  check('tailor without a key fails cleanly', noKey?.ok === false && /API key/i.test(noKey.error), JSON.stringify(noKey));

  const unknown = await send({ type: 'nonsense' });
  check('unknown request is rejected, not thrown', unknown?.ok === false, JSON.stringify(unknown));

  console.log('\nscraper');
  const page = await context.newPage();

  await page.goto(`${base}/greenhouse.html`);
  const greenhouse = await page.evaluate(scrapeJobDescription);
  check('greenhouse: finds the description', greenhouse.text.includes('PCI-DSS'), greenhouse.source);
  check('greenhouse: drops the nav chrome', !greenhouse.text.includes('Perks'), greenhouse.text.slice(0, 60));
  check('greenhouse: keeps the requirements', greenhouse.text.includes('Terraform'));

  await page.goto(`${base}/generic.html`);
  const generic = await page.evaluate(scrapeJobDescription);
  check('generic: finds the posting body', generic.text.includes('Snowflake'), generic.source);
  check('generic: skips the high-link sidebar', !generic.text.includes('Related role 2'), generic.text.slice(0, 80));
  check('generic: reports its source', generic.source === 'page content', generic.source);

  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('.posting-body'));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  const selected = await page.evaluate(scrapeJobDescription);
  check('an explicit selection wins', selected.source === 'your selection', selected.source);
  check('selection text is the selected text', selected.text.includes('Snowflake') && !selected.text.includes('Related role 1'));
  await page.close();

  console.log('\noptions page');
  await driver.waitForFunction(() => document.getElementById('model')?.options.length > 0);
  const models = await driver.$$eval('#model option', (o) => o.map((x) => x.value));
  check('lists the three models', models.length === 3 && models.includes('claude-opus-5'), models.join(','));
  check('starts with no saved resume', (await driver.textContent('#resume-state'))?.includes('No resume saved'));
  check('clear button is disabled with no resume', await driver.isDisabled('#clear'));

  await driver.fill('#api-key', 'sk-ant-test-not-a-real-key');
  await driver.dispatchEvent('#api-key', 'change');
  await driver.waitForFunction(() => document.getElementById('save-note')?.textContent?.includes('saved'));
  const settings = await driver.evaluate(() => chrome.storage.local.get('settings'));
  check('persists the API key to storage', settings?.settings?.apiKey === 'sk-ant-test-not-a-real-key');

  await driver.click('#toggle-key');
  check('show/hide toggles the key field', (await driver.getAttribute('#api-key', 'type')) === 'text');

  const badImport = await send({ type: 'parseResume', text: 'too short' });
  check('rejects a too-short resume', badImport?.ok === false && /short/i.test(badImport.error), JSON.stringify(badImport));

  console.log('\nrenderer');
  const sampleRun = {
    result: {
      job: { title: 'Senior Backend Engineer', company: 'Northwind', key_requirements: ['Go', 'PostgreSQL'] },
      resume: {
        basics: {
          name: 'Ada Lovelace', headline: 'Backend Engineer', email: 'ada@example.com',
          phone: '+1 555 0100', location: 'Bengaluru, IN',
          links: [{ label: 'GitHub', url: 'https://github.com/example' }],
        },
        summary: 'Backend engineer with seven years on payments systems.',
        skills: [{ category: 'Languages', items: ['Go', 'Python', 'SQL'] }],
        experience: [{
          company: 'Acme Payments', role: 'Senior Engineer', location: 'Remote',
          start: 'Mar 2021', end: 'Present',
          bullets: ['Owned the ledger service handling 4M daily transactions.', 'Cut p99 latency by tuning PostgreSQL partitioning.'],
        }],
        projects: [{ name: 'ledgerkit', link: 'https://example.com/ledgerkit', bullets: ['Open-source double-entry ledger in Go.'] }],
        education: [{ institution: 'IIT Bombay', credential: 'B.Tech, Computer Science', location: null, start: '2013', end: '2017', details: [] }],
        certifications: ['AWS Solutions Architect — Associate'],
      },
      changes: [{ section: 'Summary', kind: 'reworded', before: 'Engineer.', after: 'Backend engineer with seven years on payments systems.', reason: 'JD leads with payments depth.' }],
      match: { score: 78, strengths: ['Go', 'PostgreSQL'], gaps: ['Kubernetes', 'Terraform'] },
    },
    usage: { inputTokens: 2400, outputTokens: 1900, estimatedCostUsd: 0.0595 },
    model: 'claude-opus-5', jobUrl: 'https://example.com/job', createdAt: Date.now(),
  };
  await driver.evaluate((run) => chrome.storage.local.set({ lastRun: run }), sampleRun);

  const preview = await newExtensionPage('preview/index.html');
  await preview.waitForFunction(() => document.getElementById('who')?.textContent === 'Ada Lovelace');
  const frameBody = await preview.frameLocator('#frame').locator('body').innerText();
  check('preview renders the name', frameBody.includes('Ada Lovelace'));
  check('preview renders experience bullets', frameBody.includes('4M daily transactions'));
  check('preview renders education', frameBody.includes('IIT Bombay'));
  check('preview renders certifications', frameBody.includes('AWS Solutions Architect'));
  check('preview escapes nothing visibly broken', !frameBody.includes('&amp;') && !frameBody.includes('&lt;'));
  await preview.screenshot({ path: resolve(here, 'preview.png'), fullPage: true });
  await preview.close();

  console.log('\nside panel');
  const panel = await newExtensionPage('sidepanel/index.html');
  // Real side panels are narrow; make sure the layout holds there, not just at desktop width.
  await panel.setViewportSize({ width: 360, height: 900 });
  await panel.waitForFunction(() => document.getElementById('score-value')?.textContent === '78');
  check('restores the last run', true);
  check('shows the job title', (await panel.textContent('#job-title'))?.includes('Northwind'));
  check('shows gaps', (await panel.textContent('#gaps'))?.includes('Kubernetes'));
  check('shows strengths', (await panel.textContent('#strengths'))?.includes('PostgreSQL'));
  check('shows the change log', (await panel.textContent('#changes'))?.includes('JD leads with payments depth'));
  check('shows token cost', (await panel.textContent('#usage'))?.includes('$0.0'));
  check('score bar is filled', (await panel.getAttribute('#score-fill', 'style'))?.includes('78%'));
  check('no API-key banner once a key is set', await panel.isHidden('#banner'));
  const overflows = await panel.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check('no horizontal overflow at side-panel width', !overflows);
  await panel.screenshot({ path: resolve(here, 'sidepanel.png'), fullPage: true });
  await panel.close();
  await driver.close();

  console.log('\npage health');
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  await context.close();
  await rm(userDataDir, { recursive: true, force: true });
  server.close();
}

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
