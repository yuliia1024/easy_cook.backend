import { MODEL_CHARS_PER_TOKEN } from '../constants';

/** A low estimate of the tokens of `text`, enough to keep a prompt part within a budget. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / MODEL_CHARS_PER_TOKEN);
}
