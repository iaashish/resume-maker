import { resumeToHtml } from '../lib/render';
import { getLastRun } from '../lib/storage';

const frame = document.getElementById('frame') as HTMLIFrameElement;
const printBtn = document.getElementById('print') as HTMLButtonElement;
const downloadBtn = document.getElementById('download') as HTMLButtonElement;

async function init(): Promise<void> {
  const run = await getLastRun();
  if (!run) {
    document.querySelector('.page')?.classList.add('hidden');
    document.querySelector('.tip')?.classList.add('hidden');
    document.getElementById('empty')?.classList.remove('hidden');
    printBtn.disabled = true;
    downloadBtn.disabled = true;
    return;
  }

  const { resume } = run.result;
  const html = resumeToHtml(resume);
  const filename = `${(resume.basics.name || 'resume').replace(/[^\w-]+/g, '-')}-${(run.result.job.company || 'role').replace(/[^\w-]+/g, '-')}.html`;

  document.getElementById('who')!.textContent = resume.basics.name || 'Tailored resume';
  document.getElementById('for')!.textContent = [run.result.job.title, run.result.job.company]
    .filter(Boolean)
    .join(' · ');

  frame.srcdoc = html;
  frame.addEventListener('load', () => {
    // Grow the frame to its content so printing doesn't clip the second page.
    const doc = frame.contentDocument;
    if (doc) frame.style.height = `${Math.max(doc.body.scrollHeight + 40, 1122)}px`;
  });

  // Print the resume itself, not the surrounding chrome.
  printBtn.addEventListener('click', () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
  });

  downloadBtn.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  });
}

void init();
