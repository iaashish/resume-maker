import type { Resume } from './schema';
import { DEFAULT_MODEL, type Capture, type ModelId, type Settings, type StoredResume, type TailorRun } from './types';

const KEYS = {
  settings: 'settings',
  resume: 'baseResume',
  capture: 'lastCapture',
  run: 'lastRun',
  notes: 'notes',
} as const;

async function get<T>(key: string): Promise<T | undefined> {
  const bag = await chrome.storage.local.get(key);
  return bag[key] as T | undefined;
}

async function set(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function getSettings(): Promise<Settings> {
  const stored = await get<Partial<Settings>>(KEYS.settings);
  return {
    apiKey: stored?.apiKey ?? '',
    model: (stored?.model as ModelId) ?? DEFAULT_MODEL,
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await set(KEYS.settings, settings);
}

export async function getBaseResume(): Promise<StoredResume | undefined> {
  return get<StoredResume>(KEYS.resume);
}

export async function saveBaseResume(resume: Resume): Promise<void> {
  await set(KEYS.resume, { resume, updatedAt: Date.now() } satisfies StoredResume);
}

export async function clearBaseResume(): Promise<void> {
  await chrome.storage.local.remove(KEYS.resume);
}

export async function getLastCapture(): Promise<Capture | undefined> {
  return get<Capture>(KEYS.capture);
}

export async function saveLastCapture(capture: Capture): Promise<void> {
  await set(KEYS.capture, capture);
}

export async function getLastRun(): Promise<TailorRun | undefined> {
  return get<TailorRun>(KEYS.run);
}

export async function saveLastRun(run: TailorRun): Promise<void> {
  await set(KEYS.run, run);
}

export async function getNotes(): Promise<string> {
  return (await get<string>(KEYS.notes)) ?? '';
}

export async function saveNotes(notes: string): Promise<void> {
  await set(KEYS.notes, notes);
}

export type { Resume };
