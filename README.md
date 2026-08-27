# Resume Tailor

A Chrome extension that rewrites your resume for a specific job posting using the
Claude API — **without inventing experience you don't have.**

Capture a job description from the page you're looking at, and the extension returns a
tailored resume plus an honest account of what it changed and which requirements you
don't meet.

<!-- screenshots: run `npm run test` to regenerate test/sidepanel.png and test/preview.png -->

## The one design rule

Most LLM resume tools quietly fabricate: they add skills you never listed, turn
"contributed to" into "led", and invent metrics that were never in your resume. That
gets caught in interviews and reference checks.

This extension is built so the model may only **select, reorder, regroup, and reword
content that already exists in your resume**. It cannot add a skill, change a date or
title, or invent a number. When the job asks for something your resume doesn't
evidence, it leaves it out and reports it under **Gaps** — so you can decide whether
to address it in a cover letter, or skip the role.

The constraint lives in `src/lib/prompts.ts`. Every tailoring run also returns a
change log with the specific requirement that motivated each edit, so nothing is
silently rewritten.

## About your Claude subscription

**A Claude Pro/Max subscription will not work here.** It covers claude.ai and Claude
Code; it has no programmatic endpoint a third-party app can call. You need an
Anthropic API key from [console.anthropic.com](https://console.anthropic.com/settings/keys),
which is billed separately, per token.

The volume is small — roughly 2.5K input and 2K output tokens per tailoring:

| Model | Pricing (in / out per MTok) | ≈ per tailoring |
| --- | --- | --- |
| `claude-opus-5` (default) | $5 / $25 | ~$0.06 |
| `claude-sonnet-5` | $2 / $10 | ~$0.03 |
| `claude-haiku-4-5` | $1 / $5 | ~$0.01 |

Importing your base resume is a one-time call of about the same size. A hundred
applications on Opus runs under $10. Every run shows its actual token usage and
estimated cost in the side panel.

## Install

```bash
npm install
npm run build
```

Then in Chrome:

1. Go to `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → select the `dist/` folder

## Set up

1. Click the extension icon, then **Settings**.
2. Paste your Anthropic API key. It's stored in this browser's local extension
   storage and is sent only to `api.anthropic.com`.
3. Paste your resume as plain text and click **Import resume**. Claude transcribes it
   into structured JSON — at this step it only transcribes; it does not rewrite. Check
   the warnings it reports, and edit the JSON directly if it got anything wrong.

## Use

1. Open a job posting. Selecting the description text first gives the cleanest capture,
   but it isn't required.
2. Click the extension icon to open the side panel, then **Capture from this page**.
3. Optionally add notes ("keep it to one page", "emphasise the payments work").
4. **Tailor my resume** — 20–60 seconds.
5. Review the match score, gaps, and change log, then **Preview & print PDF** (choose
   *Save as PDF*, margins *Default*, headers and footers *off*), or copy as text/JSON.

## How it works

```
side panel ──capture──> chrome.scripting.executeScript ──> job posting tab
     │                                                          │
     │ <──────────────── scraped description ───────────────────┘
     │
     └──message──> service worker ──> Claude API (structured output)
                         │
                         └──> chrome.storage.local ──> preview page ──> PDF
```

- **`src/content/scrape.ts`** — extracts the job description. Site adapters for
  LinkedIn, Greenhouse, Lever, Ashby, Indeed, Workday, SmartRecruiters, Glassdoor,
  Workable and BambooHR; everything else falls back to a readability-style heuristic
  that scores containers by prose length against link density. An explicit text
  selection always wins.
- **`src/lib/schema.ts`** — the resume as a Zod schema. Because Anthropic's structured
  outputs run in strict mode, absent values are modelled as `nullable` rather than
  `optional`.
- **`src/lib/claude.ts`** — one `client.beta.messages.parse()` call per tailoring, with
  `betaZodOutputFormat` so the response comes back validated rather than as prose to
  re-parse. Adaptive thinking is on; server-side refusal fallbacks are enabled.
- **`src/background/service-worker.ts`** — holds the API key and is the only place
  that talks to the network.
- **`src/lib/render.ts`** — renders the tailored resume to print-ready HTML (single
  column, ATS-friendly) and to plain text.

The API key never leaves the service worker; the side panel and options pages talk to
it over `chrome.runtime.sendMessage`.

## Permissions

| Permission | Why |
| --- | --- |
| `storage` | Save your resume, settings, and last run locally |
| `sidePanel` | The main UI |
| `activeTab` + `scripting` | Read the job description from the tab you're on, only when you click Capture |
| `https://api.anthropic.com/*` | The only host the extension talks to |

There are no blanket host permissions. If `activeTab` isn't in effect for a tab, the
extension asks for that one origin and retries.

## Develop

```bash
npm run watch      # rebuild on change
npm run typecheck  # tsc --noEmit
npm run test       # loads dist/ in Chromium and exercises everything but the API
npm run check      # all three
```

`npm run test` launches the built extension in Chromium and verifies the message
protocol, the scraper against fixture DOM, storage round-trips, and both rendered
pages, then writes screenshots to `test/`. It needs no API key — nothing in the suite
calls Claude, so it costs nothing to run.

## Known limits

- **PDF import isn't supported.** Paste plain text. Multi-column PDF resumes extract
  badly enough that structuring the mess is worse than pasting it.
- **The scraper is best-effort on unknown sites.** If the capture looks wrong, select
  the description text and capture again, or paste it into the box.
- **One resume at a time.** There's no library of variants yet; each tailoring
  replaces the last run.
- **The tailored resume isn't editable in the UI** — export as JSON or text if you
  want to hand-adjust before sending.
