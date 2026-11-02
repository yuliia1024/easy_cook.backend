/** Token counts of a model call; a count the API did not report is 0. */
export interface ModelUsage {
  inputTokens: number;
  /** Part of `inputTokens` read from the prompt cache. */
  cachedInputTokens: number;
  outputTokens: number;
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
