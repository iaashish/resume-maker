import type { Resume, TailorResult } from './schema';

export const MODELS = [
  { id: 'claude-opus-5', label: 'Opus 5 — best quality', cost: '~$0.06 / tailoring' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5 — balanced', cost: '~$0.03 / tailoring' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5 — cheapest', cost: '~$0.01 / tailoring' },
] as const;

export type ModelId = (typeof MODELS)[number]['id'];
export const DEFAULT_MODEL: ModelId = 'claude-opus-5';

export interface Settings {
  apiKey: string;
  model: ModelId;
}

export interface StoredResume {
  resume: Resume;
  updatedAt: number;
}

export interface Capture {
  url: string;
  title: string;
  text: string;
  source: string;
  capturedAt: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface TailorRun {
  result: TailorResult;
  usage: Usage;
  model: ModelId;
  jobUrl: string;
  createdAt: number;
}

/* ---- service worker message protocol ---- */

export type Request =
  | { type: 'parseResume'; text: string }
  | { type: 'tailor'; jobDescription: string; jobUrl: string; notes: string }
  | { type: 'ping' };

export type Response<T> = { ok: true; data: T } | { ok: false; error: string };

export interface ParseResumeData {
  resume: Resume;
  warnings: string[];
  usage: Usage;
}
