import type { ModelProviderName } from '../constants/model-providers';

/** Token counts of a model call; a count the API did not report is 0. */
export interface ModelUsage {
  inputTokens: number;
  /** Part of `inputTokens` read from the prompt cache. */
  cachedInputTokens: number;
  outputTokens: number;
}

/** A model of a provider, e.g. the evals judge: called on its own, without fallback. */
export interface ModelRef {
  provider: ModelProviderName;
  id: string;
}

/** The model that answered a call and the tokens it used. */
export interface ModelCallInfo {
  modelId: string;
  usage: ModelUsage;
}

/**
 * A system prompt of the model. `version` goes up with every change of `instructions`; it is
 * logged with every call, written to the menu versions it planned and to the eval reports.
 */
export interface ModelPrompt {
  name: string;
  version: number;
  instructions: string;
}

/** The model that answered and the prompt it answered (`promptLabel`), e.g. of a planned menu. */
export interface ModelProvenance {
  modelId: string;
  prompt: string;
}

/**
 * One model response (a step of a tool loop counts as one) as the request that made it sums them
 * up: the chat logs the total of a message.
 */
export interface ModelCallRecord {
  /** `promptLabel` of the call. */
  prompt: string;
  provider: string;
  modelId: string;
  /** The step of a tool loop, from 1; 1 for a call without tools. */
  step: number;
  durationMs: number;
  /** Null when the call ended before the provider reported it: aborted or failed. */
  usage: ModelUsage | null;
  /** The SDK's finish reason, or `aborted` / `failed`. */
  finishReason: string;
}
