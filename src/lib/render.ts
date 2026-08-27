import type { Resume } from './schema';

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const bullets = (items: string[]): string =>
  items.length ? `<ul>${items.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>` : '';

/** Print stylesheet tuned for a clean single-column ATS-friendly page. */
const PRINT_CSS = `
  @page { margin: 14mm 14mm; }
  * { box-sizing: border-box; }
  body {
    font: 10.5pt/1.42 "Georgia", "Times New Roman", serif;
    color: #1a1a1a; margin: 0; max-width: 190mm;
  }
  h1 { font-size: 19pt; margin: 0 0 2px; letter-spacing: 0.2px; }
  .headline { font-size: 11pt; color: #444; margin: 0 0 4px; }
  .contact { font-size: 9pt; color: #444; margin: 0 0 14px; }
  .contact a { color: #444; text-decoration: none; }
  h2 {
    font-size: 10pt; text-transform: uppercase; letter-spacing: 1.1px;
    border-bottom: 1px solid #999; padding-bottom: 2px; margin: 15px 0 7px;
  }
  .entry { margin-bottom: 10px; page-break-inside: avoid; }
  .entry-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
  .entry-title { font-weight: bold; }
  .entry-meta { font-size: 9pt; color: #555; white-space: nowrap; }
  .entry-sub { font-size: 9.5pt; color: #333; font-style: italic; }
  ul { margin: 4px 0 0; padding-left: 17px; }
  li { margin-bottom: 2.5px; }
  .skill-row { margin-bottom: 3px; }
  .skill-cat { font-weight: bold; }
  p.summary { margin: 0 0 2px; }
`;

export function resumeToHtml(resume: Resume): string {
  const { basics } = resume;

  const contact = [
    basics.email,
    basics.phone,
    basics.location,
    ...basics.links.map((l) => `<a href="${escapeHtml(l.url)}">${escapeHtml(l.label)}</a>`),
  ].filter((v): v is string => Boolean(v && v.trim()));

  const sections: string[] = [];

  if (resume.summary?.trim()) {
    sections.push(`<h2>Summary</h2><p class="summary">${escapeHtml(resume.summary)}</p>`);
  }

  if (resume.skills.length) {
    const rows = resume.skills
      .filter((g) => g.items.length)
      .map(
        (g) =>
          `<div class="skill-row"><span class="skill-cat">${escapeHtml(g.category)}:</span> ${escapeHtml(g.items.join(', '))}</div>`,
      )
      .join('');
    if (rows) sections.push(`<h2>Skills</h2>${rows}`);
  }

  if (resume.experience.length) {
    const entries = resume.experience
      .map(
        (e) => `<div class="entry">
          <div class="entry-head">
            <span class="entry-title">${escapeHtml(e.role)}</span>
            <span class="entry-meta">${escapeHtml([e.start, e.end].filter(Boolean).join(' – '))}</span>
          </div>
          <div class="entry-sub">${escapeHtml([e.company, e.location].filter(Boolean).join(' · '))}</div>
          ${bullets(e.bullets)}
        </div>`,
      )
      .join('');
    sections.push(`<h2>Experience</h2>${entries}`);
  }

  if (resume.projects.length) {
    const entries = resume.projects
      .map(
        (p) => `<div class="entry">
          <div class="entry-head">
            <span class="entry-title">${escapeHtml(p.name)}</span>
            ${p.link ? `<span class="entry-meta"><a href="${escapeHtml(p.link)}">${escapeHtml(p.link)}</a></span>` : ''}
          </div>
          ${bullets(p.bullets)}
        </div>`,
      )
      .join('');
    sections.push(`<h2>Projects</h2>${entries}`);
  }

  if (resume.education.length) {
    const entries = resume.education
      .map(
        (e) => `<div class="entry">
          <div class="entry-head">
            <span class="entry-title">${escapeHtml(e.credential)}</span>
            <span class="entry-meta">${escapeHtml([e.start, e.end].filter(Boolean).join(' – '))}</span>
          </div>
          <div class="entry-sub">${escapeHtml([e.institution, e.location].filter(Boolean).join(' · '))}</div>
          ${bullets(e.details)}
        </div>`,
      )
      .join('');
    sections.push(`<h2>Education</h2>${entries}`);
  }

  if (resume.certifications.length) {
    sections.push(`<h2>Certifications</h2>${bullets(resume.certifications)}`);
  }

  return `<!doctype html>
<html><head><meta charset="utf-8">
<title>${escapeHtml(basics.name || 'Resume')}</title>
<style>${PRINT_CSS}</style>
</head><body>
<h1>${escapeHtml(basics.name)}</h1>
${basics.headline ? `<p class="headline">${escapeHtml(basics.headline)}</p>` : ''}
${contact.length ? `<p class="contact">${contact.join(' &nbsp;·&nbsp; ')}</p>` : ''}
${sections.join('\n')}
</body></html>`;
}

/** Plain text, for pasting into application forms that reject file uploads. */
export function resumeToText(resume: Resume): string {
  const out: string[] = [];
  const { basics } = resume;
  out.push(basics.name);
  if (basics.headline) out.push(basics.headline);
  const contact = [basics.email, basics.phone, basics.location, ...basics.links.map((l) => l.url)].filter(Boolean);
  if (contact.length) out.push(contact.join(' | '));

  const heading = (t: string) => out.push('', t.toUpperCase(), '='.repeat(t.length));

  if (resume.summary?.trim()) {
    heading('Summary');
    out.push(resume.summary);
  }
  if (resume.skills.length) {
    heading('Skills');
    for (const g of resume.skills) out.push(`${g.category}: ${g.items.join(', ')}`);
  }
  if (resume.experience.length) {
    heading('Experience');
    for (const e of resume.experience) {
      out.push('', `${e.role} — ${[e.company, e.location].filter(Boolean).join(', ')} (${e.start} – ${e.end})`);
      for (const b of e.bullets) out.push(`  - ${b}`);
    }
  }
  if (resume.projects.length) {
    heading('Projects');
    for (const p of resume.projects) {
      out.push('', p.link ? `${p.name} (${p.link})` : p.name);
      for (const b of p.bullets) out.push(`  - ${b}`);
    }
  }
  if (resume.education.length) {
    heading('Education');
    for (const e of resume.education) {
      out.push('', `${e.credential} — ${e.institution}${e.end ? ` (${[e.start, e.end].filter(Boolean).join(' – ')})` : ''}`);
      for (const d of e.details) out.push(`  - ${d}`);
    }
  }
  if (resume.certifications.length) {
    heading('Certifications');
    for (const c of resume.certifications) out.push(`  - ${c}`);
  }
  return out.join('\n');
}
