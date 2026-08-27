import { ClaudeError, parseResumeText, tailorResume } from '../lib/claude';
import { getBaseResume, getSettings, saveBaseResume, saveLastRun } from '../lib/storage';
import type { ParseResumeData, Request, Response, TailorRun } from '../lib/types';

// Clicking the toolbar icon opens the side panel (and grants activeTab for that tab,
// which is what lets us read the job posting without blanket host permissions).
chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    /* older Chrome builds: the manifest side_panel entry still works */
  });
});

async function handle(request: Request): Promise<unknown> {
  const settings = await getSettings();

  if (request.type === 'ping') {
    return { hasKey: Boolean(settings.apiKey), model: settings.model };
  }

  if (!settings.apiKey) {
    throw new ClaudeError('No API key set. Open the extension options and add your Anthropic API key.');
  }

  if (request.type === 'parseResume') {
    if (request.text.trim().length < 80) {
      throw new ClaudeError('That looks too short to be a resume. Paste the full text and try again.');
    }
    const { parsed, usage } = await parseResumeText(settings.apiKey, settings.model, request.text);
    await saveBaseResume(parsed.resume);
    return { resume: parsed.resume, warnings: parsed.warnings, usage } satisfies ParseResumeData;
  }

  if (request.type === 'tailor') {
    const stored = await getBaseResume();
    if (!stored) {
      throw new ClaudeError('No base resume saved yet. Add one in the extension options first.');
    }
    if (request.jobDescription.trim().length < 120) {
      throw new ClaudeError('The captured job description is too short. Select the text on the page and capture again.');
    }
    const { result, usage } = await tailorResume(
      settings.apiKey,
      settings.model,
      stored.resume,
      request.jobDescription,
      request.notes,
    );
    const run: TailorRun = {
      result,
      usage,
      model: settings.model,
      jobUrl: request.jobUrl,
      createdAt: Date.now(),
    };
    await saveLastRun(run);
    return run;
  }

  throw new ClaudeError(`Unknown request: ${JSON.stringify(request)}`);
}

chrome.runtime.onMessage.addListener((request: Request, _sender, sendResponse) => {
  handle(request)
    .then((data) => sendResponse({ ok: true, data } satisfies Response<unknown>))
    .catch((err: unknown) =>
      sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      } satisfies Response<never>),
    );
  return true; // keep the message channel open for the async response
});
