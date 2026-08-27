import { scrapeJobDescription } from '../content/scrape';
import { resumeToText } from '../lib/render';
import { getLastCapture, getLastRun, getNotes, saveLastCapture, saveNotes } from '../lib/storage';
import type { Capture, Request, Response, TailorRun, Usage } from '../lib/types';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const ui = {
  banner: $<HTMLDivElement>('banner'),
  capture: $<HTMLButtonElement>('capture'),
  captureMeta: $<HTMLSpanElement>('capture-meta'),
  jd: $<HTMLTextAreaElement>('jd'),
  notes: $<HTMLTextAreaElement>('notes'),
  tailor: $<HTMLButtonElement>('tailor'),
  status: $<HTMLParagraphElement>('status'),
  results: $<HTMLElement>('results'),
  jobTitle: $<HTMLHeadingElement>('job-title'),
  usage: $<HTMLSpanElement>('usage'),
  scoreValue: $<HTMLSpanElement>('score-value'),
  scoreFill: $<HTMLDivElement>('score-fill'),
  gaps: $<HTMLUListElement>('gaps'),
  gapsCount: $<HTMLSpanElement>('gaps-count'),
  strengths: $<HTMLUListElement>('strengths'),
  strengthsCount: $<HTMLSpanElement>('strengths-count'),
  changes: $<HTMLDivElement>('changes'),
  changesCount: $<HTMLSpanElement>('changes-count'),
  preview: $<HTMLButtonElement>('preview'),
  copyText: $<HTMLButtonElement>('copy-text'),
  copyJson: $<HTMLButtonElement>('copy-json'),
  openOptions: $<HTMLButtonElement>('open-options'),
};

let lastRun: TailorRun | undefined;

function send<T>(request: Request): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(request, (response: Response<T> | undefined) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response) return reject(new Error('No response from the extension background worker.'));
      response.ok ? resolve(response.data) : reject(new Error(response.error));
    });
  });
}

function setStatus(text: string, kind: 'working' | 'error' | 'done' | '' = ''): void {
  ui.status.textContent = text;
  ui.status.className = `status ${kind}`;
}

function showBanner(html: string, kind: 'warn' | 'error' = 'warn'): void {
  ui.banner.className = `banner ${kind === 'error' ? 'error' : ''}`;
  ui.banner.innerHTML = html;
  ui.banner.classList.remove('hidden');
}

function formatUsage(usage: Usage): string {
  const cost = usage.estimatedCostUsd;
  const shown = cost < 0.01 ? '<$0.01' : `$${cost.toFixed(3)}`;
  return `${usage.inputTokens.toLocaleString()} in · ${usage.outputTokens.toLocaleString()} out · ~${shown}`;
}

/* ---------- capture ---------- */

async function activeTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab.');
  return tab;
}

async function capture(): Promise<void> {
  ui.capture.disabled = true;
  setStatus('Reading the page…', 'working');
  try {
    const tab = await activeTab();
    if (!tab.url || /^(chrome|edge|about|chrome-extension):/.test(tab.url)) {
      throw new Error('This is a browser page. Open the job posting first, then capture.');
    }

    let results: chrome.scripting.InjectionResult<ReturnType<typeof scrapeJobDescription>>[];
    try {
      results = await chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        func: scrapeJobDescription,
      });
    } catch {
      // activeTab wasn't granted for this tab (common if the panel was already open
      // when the user navigated). Ask for the origin explicitly and retry once.
      const origin = `${new URL(tab.url).origin}/*`;
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) throw new Error('Permission denied for this site. Paste the description manually instead.');
      results = await chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        func: scrapeJobDescription,
      });
    }

    const scraped = results[0]?.result;
    if (!scraped?.text) throw new Error('Could not read any text from this page.');

    ui.jd.value = scraped.text;
    const record: Capture = {
      url: tab.url,
      title: scraped.title,
      text: scraped.text,
      source: scraped.source,
      capturedAt: Date.now(),
    };
    await saveLastCapture(record);
    renderCaptureMeta(record);
    setStatus(
      scraped.source === 'whole page'
        ? 'Grabbed the whole page — check it below and trim if needed.'
        : 'Captured. Check it below before tailoring.',
      'done',
    );
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), 'error');
  } finally {
    ui.capture.disabled = false;
  }
}

function renderCaptureMeta(record: Capture | undefined): void {
  ui.captureMeta.textContent = record
    ? `${record.source} · ${record.text.length.toLocaleString()} chars`
    : '';
}

/* ---------- tailor ---------- */

async function tailor(): Promise<void> {
  const jobDescription = ui.jd.value.trim();
  if (jobDescription.length < 120) {
    setStatus('Add a job description first — capture it or paste it above.', 'error');
    return;
  }

  ui.tailor.disabled = true;
  setStatus('Tailoring… this usually takes 20–60 seconds.', 'working');
  const startedAt = Date.now();
  const tick = setInterval(() => {
    setStatus(`Tailoring… ${Math.round((Date.now() - startedAt) / 1000)}s`, 'working');
  }, 1000);

  try {
    const capturedUrl = (await getLastCapture())?.url ?? '';
    const run = await send<TailorRun>({
      type: 'tailor',
      jobDescription,
      jobUrl: capturedUrl,
      notes: ui.notes.value,
    });
    renderRun(run);
    setStatus(`Done in ${Math.round((Date.now() - startedAt) / 1000)}s.`, 'done');
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), 'error');
  } finally {
    clearInterval(tick);
    ui.tailor.disabled = false;
  }
}

function renderRun(run: TailorRun): void {
  lastRun = run;
  const { job, match, changes } = run.result;

  ui.jobTitle.textContent = [job.title, job.company].filter(Boolean).join(' · ') || 'Result';
  ui.usage.textContent = formatUsage(run.usage);

  const score = Math.max(0, Math.min(100, Math.round(match.score)));
  ui.scoreValue.textContent = String(score);
  ui.scoreFill.style.width = `${score}%`;

  const fill = (list: HTMLUListElement, count: HTMLSpanElement, items: string[]) => {
    list.replaceChildren(
      ...items.map((item) => {
        const li = document.createElement('li');
        li.textContent = item;
        return li;
      }),
    );
    count.textContent = String(items.length);
  };
  fill(ui.gaps, ui.gapsCount, match.gaps);
  fill(ui.strengths, ui.strengthsCount, match.strengths);

  ui.changes.replaceChildren(
    ...changes.map((change) => {
      const wrap = document.createElement('div');
      wrap.className = 'change';

      const head = document.createElement('div');
      head.className = 'change-head';
      const section = document.createElement('span');
      section.className = 'change-section';
      section.textContent = change.section;
      const kind = document.createElement('span');
      kind.className = 'change-kind';
      kind.textContent = change.kind;
      head.append(section, kind);

      const reason = document.createElement('p');
      reason.className = 'change-reason';
      reason.textContent = change.reason;

      const diff = document.createElement('div');
      diff.className = 'change-diff';
      if (change.before) {
        const del = document.createElement('del');
        del.textContent = change.before;
        diff.append(del);
      }
      if (change.after) {
        const ins = document.createElement('ins');
        ins.textContent = change.after;
        diff.append(ins);
      }

      wrap.append(head, reason, diff);
      return wrap;
    }),
  );
  ui.changesCount.textContent = String(changes.length);

  ui.results.classList.remove('hidden');
}

/* ---------- exports ---------- */

async function copy(button: HTMLButtonElement, text: string): Promise<void> {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Copy failed';
  }
  setTimeout(() => {
    button.textContent = original;
  }, 1400);
}

/* ---------- boot ---------- */

async function init(): Promise<void> {
  ui.capture.addEventListener('click', () => void capture());
  ui.tailor.addEventListener('click', () => void tailor());
  ui.openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());
  ui.notes.addEventListener('change', () => void saveNotes(ui.notes.value));
  ui.preview.addEventListener('click', () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('preview/index.html') });
  });
  ui.copyText.addEventListener('click', () => {
    if (lastRun) void copy(ui.copyText, resumeToText(lastRun.result.resume));
  });
  ui.copyJson.addEventListener('click', () => {
    if (lastRun) void copy(ui.copyJson, JSON.stringify(lastRun.result.resume, null, 2));
  });

  const [capturedRecord, notes, previousRun, state] = await Promise.all([
    getLastCapture(),
    getNotes(),
    getLastRun(),
    send<{ hasKey: boolean }>({ type: 'ping' }).catch(() => ({ hasKey: false })),
  ]);

  if (capturedRecord) {
    ui.jd.value = capturedRecord.text;
    renderCaptureMeta(capturedRecord);
  }
  ui.notes.value = notes;
  if (previousRun) renderRun(previousRun);

  if (!state.hasKey) {
    showBanner(
      'No Anthropic API key set yet. <button id="banner-options" type="button">Open settings</button>',
      'warn',
    );
    document.getElementById('banner-options')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
  }
}

void init();
