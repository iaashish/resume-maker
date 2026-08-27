import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';

import { PARSE_SYSTEM, TAILOR_SYSTEM, parseUserMessage, tailorUserMessage } from './prompts';
import { ParsedResumeSchema, TailorResultSchema, type ParsedResume, type Resume, type TailorResult } from './schema';
import type { ModelId, Usage } from './types';

/** USD per million tokens, mirroring Anthropic's published list pricing. */
const PRICING: Record<ModelId, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

/** Server-side refusal fallbacks: if a safety classifier declines, the API reroutes
 *  rather than handing us a dead turn. Cheap insurance, no model list to maintain. */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

function client(apiKey: string): Anthropic {
  return new Anthropic({
    apiKey,
    // The service worker is a browser context. The key is the user's own, stored
    // locally in chrome.storage and never sent anywhere but api.anthropic.com.
    dangerouslyAllowBrowser: true,
    maxRetries: 2,
  });
}

function usageOf(model: ModelId, usage: { input_tokens: number; output_tokens: number }): Usage {
  const price = PRICING[model];
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    estimatedCostUsd:
      (usage.input_tokens / 1_000_000) * price.input + (usage.output_tokens / 1_000_000) * price.output,
  };
}

export class ClaudeError extends Error {}

/** Turn SDK failures into something a side panel can show a human. */
function explain(err: unknown): never {
  if (err instanceof Anthropic.AuthenticationError) {
    throw new ClaudeError('That API key was rejected. Check it in the extension options — it should start with "sk-ant-".');
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    throw new ClaudeError('Your API key does not have access to this model. Try a different model in options.');
  }
  if (err instanceof Anthropic.NotFoundError) {
    throw new ClaudeError('That model is not available on your account. Pick another one in the extension options.');
  }
  if (err instanceof Anthropic.RateLimitError) {
    throw new ClaudeError('Rate limited by the API. Wait a few seconds and try again.');
  }
  if (err instanceof Anthropic.BadRequestError) {
    throw new ClaudeError(`The API rejected the request: ${err.message}`);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    throw new ClaudeError('Could not reach api.anthropic.com. Check your connection and try again.');
  }
  if (err instanceof Anthropic.InternalServerError) {
    throw new ClaudeError('The API had a server error. Wait a moment and try again.');
  }
  if (err instanceof Anthropic.APIError) {
    throw new ClaudeError(`API error ${err.status ?? ''}: ${err.message}`.replace('  ', ' '));
  }
  if (err instanceof ClaudeError) throw err;
  throw new ClaudeError(err instanceof Error ? err.message : String(err));
}

/** `stop_reason: "refusal"` arrives as a 200, so it must be checked explicitly. */
function assertNotRefused(message: { stop_reason: string | null; stop_details?: unknown }): void {
  if (message.stop_reason === 'refusal') {
    throw new ClaudeError('Claude declined to complete this request. Try rephrasing your notes or the captured text.');
  }
  if (message.stop_reason === 'max_tokens') {
    throw new ClaudeError('The response was cut off before it finished. Try trimming the job description and retrying.');
  }
}

export async function parseResumeText(
  apiKey: string,
  model: ModelId,
  text: string,
): Promise<{ parsed: ParsedResume; usage: Usage }> {
  try {
    const message = await client(apiKey).beta.messages.parse({
      model,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      system: PARSE_SYSTEM,
      messages: [{ role: 'user', content: parseUserMessage(text) }],
      output_config: { format: betaZodOutputFormat(ParsedResumeSchema) },
    });
    assertNotRefused(message);
    if (!message.parsed_output) {
      throw new ClaudeError('Claude returned a response that did not match the resume format. Try again.');
    }
    return { parsed: message.parsed_output, usage: usageOf(model, message.usage) };
  } catch (err) {
    explain(err);
  }
}

export async function tailorResume(
  apiKey: string,
  model: ModelId,
  resume: Resume,
  jobDescription: string,
  notes: string,
): Promise<{ result: TailorResult; usage: Usage }> {
  try {
    const message = await client(apiKey).beta.messages.parse({
      model,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      system: TAILOR_SYSTEM,
      messages: [
        { role: 'user', content: tailorUserMessage(JSON.stringify(resume, null, 2), jobDescription, notes) },
      ],
      output_config: { format: betaZodOutputFormat(TailorResultSchema) },
    });
    assertNotRefused(message);
    if (!message.parsed_output) {
      throw new ClaudeError('Claude returned a response that did not match the expected format. Try again.');
    }
    return { result: message.parsed_output, usage: usageOf(model, message.usage) };
  } catch (err) {
    explain(err);
  }
}
