import { z } from 'zod/v4';

/**
 * Anthropic structured outputs run in strict mode: every property must appear in
 * `required` and objects must set `additionalProperties: false`. `.optional()`
 * drops a key out of `required`, so absent values are modelled as `.nullable()`
 * instead — the model must emit the key, and may emit `null`.
 */

export const LinkSchema = z.object({
  label: z.string().describe('e.g. "GitHub", "LinkedIn", "Portfolio"'),
  url: z.string(),
});

export const BasicsSchema = z.object({
  name: z.string(),
  headline: z.string().nullable().describe('Short professional title, e.g. "Senior Backend Engineer"'),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  location: z.string().nullable(),
  links: z.array(LinkSchema),
});

export const SkillGroupSchema = z.object({
  category: z.string().describe('e.g. "Languages", "Cloud & Infrastructure"'),
  items: z.array(z.string()),
});

export const ExperienceSchema = z.object({
  company: z.string(),
  role: z.string(),
  location: z.string().nullable(),
  start: z.string().describe('e.g. "Jan 2022"'),
  end: z.string().describe('e.g. "Present"'),
  bullets: z.array(z.string()),
});

export const ProjectSchema = z.object({
  name: z.string(),
  link: z.string().nullable(),
  bullets: z.array(z.string()),
});

export const EducationSchema = z.object({
  institution: z.string(),
  credential: z.string().describe('e.g. "B.Tech, Computer Science"'),
  location: z.string().nullable(),
  start: z.string().nullable(),
  end: z.string().nullable(),
  details: z.array(z.string()),
});

export const ResumeSchema = z.object({
  basics: BasicsSchema,
  summary: z.string().nullable(),
  skills: z.array(SkillGroupSchema),
  experience: z.array(ExperienceSchema),
  projects: z.array(ProjectSchema),
  education: z.array(EducationSchema),
  certifications: z.array(z.string()),
});

/** Wrapper so the parse call returns a single top-level object. */
export const ParsedResumeSchema = z.object({
  resume: ResumeSchema,
  warnings: z
    .array(z.string())
    .describe('Anything ambiguous or missing in the source text that the user should check.'),
});

export const ChangeSchema = z.object({
  section: z.string().describe('Where the change lands, e.g. "Summary", "Experience — Acme Corp"'),
  kind: z.enum(['reworded', 'reordered', 'emphasized', 'omitted', 'regrouped']),
  before: z.string().describe('The original text, or a short description of the original ordering.'),
  after: z.string().describe('The new text, or a short description of the new ordering. Empty string if omitted.'),
  reason: z.string().describe('Which specific job requirement motivated this change.'),
});

export const TailorResultSchema = z.object({
  job: z.object({
    title: z.string(),
    company: z.string(),
    key_requirements: z.array(z.string()).describe('The requirements that actually drive the screen, most important first.'),
  }),
  resume: ResumeSchema,
  changes: z.array(ChangeSchema),
  match: z.object({
    score: z.number().describe('0-100 honest estimate of fit based only on evidence in the resume.'),
    strengths: z.array(z.string()).describe('Requirements the resume genuinely evidences.'),
    gaps: z.array(z.string()).describe('Requirements the resume does not evidence. Do not paper over these.'),
  }),
});

export type Link = z.infer<typeof LinkSchema>;
export type Basics = z.infer<typeof BasicsSchema>;
export type SkillGroup = z.infer<typeof SkillGroupSchema>;
export type Experience = z.infer<typeof ExperienceSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Education = z.infer<typeof EducationSchema>;
export type Resume = z.infer<typeof ResumeSchema>;
export type ParsedResume = z.infer<typeof ParsedResumeSchema>;
export type Change = z.infer<typeof ChangeSchema>;
export type TailorResult = z.infer<typeof TailorResultSchema>;
