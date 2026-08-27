import { ResumeSchema } from '../lib/schema';
import { clearBaseResume, getBaseResume, getSettings, saveBaseResume, saveSettings } from '../lib/storage';
import { MODELS, type ModelId, type ParseResumeData, type Request, type Response } from '../lib/types';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const ui = {
  apiKey: $<HTMLInputElement>('api-key'),
  toggleKey: $<HTMLButtonElement>('toggle-key'),
  model: $<HTMLSelectElement>('model'),
  modelCost: $<HTMLParagraphElement>('model-cost'),
  resumeState: $<HTMLDivElement>('resume-state'),
  resumeText: $<HTMLTextAreaElement>('resume-text'),
  importBtn: $<HTMLButtonElement>('import'),
  clearBtn: $<HTMLButtonElement>('clear'),
  importStatus: $<HTMLParagraphElement>('import-status'),
  warnings: $<HTMLDivElement>('warnings'),
  warningList: $<HTMLUListElement>('warning-list'),
  jsonWrap: $<HTMLDetailsElement>('resume-json-wrap'),
  json: $<HTMLTextAreaElement>('resume-json'),
  saveJson: $<HTMLButtonElement>('save-json'),
  jsonStatus: $<HTMLParagraphElement>('json-status'),
  saveNote: $<HTMLParagraphElement>('save-note'),
};

function send<T>(request: Request): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(request, (response: Response<T> | undefined) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response) return reject(new Error('No response from the extension background worker.'));
      response.ok ? resolve(response.data) : reject(new Error(response.error));
    });
  });
}

function setStatus(el: HTMLElement, text: string, kind: 'working' | 'error' | 'done' | '' = ''): void {
  el.textContent = text;
  el.className = `status ${kind}`;
}

let noteTimer: number | undefined;
function flashSaved(): void {
  ui.saveNote.textContent = 'Settings saved.';
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => (ui.saveNote.textContent = ''), 1800) as unknown as number;
}

async function persistSettings(): Promise<void> {
  await saveSettings({ apiKey: ui.apiKey.value.trim(), model: ui.model.value as ModelId });
  flashSaved();
}

function renderModelCost(): void {
  const model = MODELS.find((m) => m.id === ui.model.value);
  ui.modelCost.textContent = model ? `Roughly ${model.cost} at Anthropic's list pricing.` : '';
}

async function renderResumeState(): Promise<void> {
  const stored = await getBaseResume();
  if (!stored) {
    ui.resumeState.textContent = 'No resume saved yet.';
    ui.resumeState.className = 'state';
    ui.jsonWrap.classList.add('hidden');
    ui.clearBtn.disabled = true;
    return;
  }
  const { resume } = stored;
  const counts = [
    `${resume.experience.length} role${resume.experience.length === 1 ? '' : 's'}`,
    `${resume.skills.reduce((n, g) => n + g.items.length, 0)} skills`,
    `${resume.projects.length} projects`,
    `${resume.education.length} education entries`,
  ].join(' · ');
  ui.resumeState.textContent = `Saved: ${resume.basics.name || 'unnamed'} — ${counts} (updated ${new Date(stored.updatedAt).toLocaleString()})`;
  ui.resumeState.className = 'state ok';
  ui.json.value = JSON.stringify(resume, null, 2);
  ui.jsonWrap.classList.remove('hidden');
  ui.clearBtn.disabled = false;
}

async function importResume(): Promise<void> {
  const text = ui.resumeText.value.trim();
  if (text.length < 80) {
    setStatus(ui.importStatus, 'Paste your full resume text first.', 'error');
    return;
  }
  ui.importBtn.disabled = true;
  ui.warnings.classList.add('hidden');
  setStatus(ui.importStatus, 'Reading your resume…', 'working');
  try {
    const data = await send<ParseResumeData>({ type: 'parseResume', text });
    await renderResumeState();
    setStatus(
      ui.importStatus,
      `Imported. ${data.usage.inputTokens.toLocaleString()} in / ${data.usage.outputTokens.toLocaleString()} out tokens.`,
      'done',
    );
    if (data.warnings.length) {
      ui.warningList.replaceChildren(
        ...data.warnings.map((w) => {
          const li = document.createElement('li');
          li.textContent = w;
          return li;
        }),
      );
      ui.warnings.classList.remove('hidden');
    }
  } catch (err) {
    setStatus(ui.importStatus, err instanceof Error ? err.message : String(err), 'error');
  } finally {
    ui.importBtn.disabled = false;
  }
}

async function saveJsonEdits(): Promise<void> {
  try {
    const parsed = ResumeSchema.parse(JSON.parse(ui.json.value));
    await saveBaseResume(parsed);
    await renderResumeState();
    setStatus(ui.jsonStatus, 'Saved.', 'done');
  } catch (err) {
    const message =
      err instanceof SyntaxError
        ? `That is not valid JSON: ${err.message}`
        : `That JSON does not match the resume schema: ${err instanceof Error ? err.message : String(err)}`;
    setStatus(ui.jsonStatus, message, 'error');
  }
}

async function init(): Promise<void> {
  for (const model of MODELS) {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.label;
    ui.model.append(option);
  }

  const settings = await getSettings();
  ui.apiKey.value = settings.apiKey;
  ui.model.value = settings.model;
  renderModelCost();
  await renderResumeState();

  ui.apiKey.addEventListener('change', () => void persistSettings());
  ui.model.addEventListener('change', () => {
    renderModelCost();
    void persistSettings();
  });
  ui.toggleKey.addEventListener('click', () => {
    const showing = ui.apiKey.type === 'text';
    ui.apiKey.type = showing ? 'password' : 'text';
    ui.toggleKey.textContent = showing ? 'Show' : 'Hide';
  });
  ui.importBtn.addEventListener('click', () => void importResume());
  ui.saveJson.addEventListener('click', () => void saveJsonEdits());
  ui.clearBtn.addEventListener('click', () => {
    void (async () => {
      await clearBaseResume();
      await renderResumeState();
      setStatus(ui.importStatus, 'Saved resume cleared.', '');
    })();
  });
}

void init();
