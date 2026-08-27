/**
 * Injected into the job posting tab via chrome.scripting.executeScript({ func }).
 *
 * IMPORTANT: this function is serialised and evaluated in the page, so it must be
 * entirely self-contained — every helper lives inside it, and it may not reference
 * imports, module-scope constants, or anything from the bundle.
 */
export function scrapeJobDescription(): { text: string; source: string; title: string } {
  const clean = (s: string): string =>
    s
      .replace(/ /g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .trim();

  const textOf = (el: Element | null): string => (el ? clean((el as HTMLElement).innerText || '') : '');

  // 1. An explicit selection always wins — it is the user telling us exactly what they mean.
  const selection = clean(window.getSelection()?.toString() ?? '');
  if (selection.length > 200) {
    return { text: selection, source: 'your selection', title: document.title };
  }

  // 2. Known job boards, where the description lives in a predictable container.
  const adapters: Array<{ host: RegExp; name: string; selectors: string[] }> = [
    {
      host: /linkedin\.com$/,
      name: 'LinkedIn',
      selectors: [
        '.jobs-description__content',
        '.jobs-box__html-content',
        '#job-details',
        '.show-more-less-html__markup',
        '.description__text',
      ],
    },
    { host: /greenhouse\.io$/, name: 'Greenhouse', selectors: ['#content', '.job__description', '.opening'] },
    { host: /lever\.co$/, name: 'Lever', selectors: ['.posting-page', '.section-wrapper.page-full-width', '.content'] },
    { host: /ashbyhq\.com$/, name: 'Ashby', selectors: ['[class*="descriptionText"]', 'main'] },
    { host: /indeed\.com$/, name: 'Indeed', selectors: ['#jobDescriptionText', '.jobsearch-JobComponent-description'] },
    { host: /myworkdayjobs\.com$/, name: 'Workday', selectors: ['[data-automation-id="jobPostingDescription"]', '[data-automation-id="job-posting-details"]'] },
    { host: /smartrecruiters\.com$/, name: 'SmartRecruiters', selectors: ['.job-sections', '#st-jobDescription', 'main'] },
    { host: /glassdoor\.[a-z.]+$/, name: 'Glassdoor', selectors: ['[class*="JobDetails_jobDescription"]', '#JobDescriptionContainer'] },
    { host: /workable\.com$/, name: 'Workable', selectors: ['[data-ui="job-description"]', 'main'] },
    { host: /bamboohr\.com$/, name: 'BambooHR', selectors: ['.jss-g', '#content', 'main'] },
  ];

  const host = location.hostname.replace(/^www\./, '');
  for (const adapter of adapters) {
    if (!adapter.host.test(host)) continue;
    for (const selector of adapter.selectors) {
      let el: Element | null = null;
      try {
        el = document.querySelector(selector);
      } catch {
        continue; // tolerate the wildcard-ish selectors above
      }
      const text = textOf(el);
      if (text.length > 200) return { text, source: adapter.name, title: document.title };
    }
  }

  // 3. Generic fallback: score candidate containers by how much prose they hold
  //    relative to how much of that prose is navigation links.
  const skip = /^(script|style|nav|header|footer|aside|noscript|svg|form|button)$/i;
  let best: { el: Element; score: number } | null = null;

  for (const el of Array.from(document.querySelectorAll('article, main, section, div, [role="main"]'))) {
    if (skip.test(el.tagName)) continue;
    const text = (el as HTMLElement).innerText || '';
    const length = text.length;
    if (length < 400 || length > 60_000) continue;

    const linkChars = Array.from(el.querySelectorAll('a')).reduce(
      (sum, a) => sum + ((a as HTMLElement).innerText || '').length,
      0,
    );
    const linkDensity = linkChars / length;
    if (linkDensity > 0.35) continue;

    // Prefer the *deepest* container that still holds the whole description, so we
    // don't drag in the entire page chrome along with it.
    const depth = (() => {
      let d = 0;
      let node: Element | null = el;
      while (node) {
        d++;
        node = node.parentElement;
      }
      return d;
    })();

    const score = length * (1 - linkDensity) * (1 + depth / 40);
    if (!best || score > best.score) best = { el, score };
  }

  if (best) {
    const text = textOf(best.el);
    if (text.length > 200) return { text, source: 'page content', title: document.title };
  }

  return { text: textOf(document.body), source: 'whole page', title: document.title };
}
