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
