/** An LLM API the app can call; `MODEL_PROVIDERS` orders them, the first one serves, the rest are fallbacks. */
export enum ModelProviderName {
  OpenAi = 'openai',
  DeepSeek = 'deepseek',
  Anthropic = 'anthropic',
}

export const DEFAULT_MODEL_PROVIDERS: readonly ModelProviderName[] = [ModelProviderName.OpenAi];

/**
 * The fallback model, Flash with thinking off: close to `OPEN_AI_MODEL` in speed and price.
 * DeepSeek has no dated snapshots (now DeepSeek-V4.1-Flash-1017; `deepseek-v4-flash` is retired),
 * so the evals keep a baseline of their own for it (`--provider deepseek`) and the log of every
 * response names the model that answered.
 */
export const DEEPSEEK_MODEL = 'deepseek-flash';
/** A dated snapshot; the evals judge, or a provider of `MODEL_PROVIDERS`. */
export const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

/**
 * One request to one provider until it answers: the whole response of a generation, the first
 * output of a stream. A slower provider is retried, then the next one is called.
 */
export const MODEL_ATTEMPT_TIMEOUT_MS = 20_000;
/** A whole call, retries and fallbacks included. */
export const MODEL_CALL_TIMEOUT_MS = 60_000;
/** Retries of a provider on a 5xx, 408, 409, 429, network error or attempt timeout, before the next provider. */
export const MODEL_PROVIDER_RETRIES = 1;
/** Before the first retry of a provider, doubled for every next one. */
export const MODEL_RETRY_DELAY_MS = 500;
