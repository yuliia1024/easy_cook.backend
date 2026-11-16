import { parseArgs } from 'node:util';
import { ModelProviderName } from '../../src/common/constants';

export const DEFAULT_CONCURRENCY = 5;
/** Runs of every case; the rates average them, so one lucky or unlucky answer moves them less. */
export const DEFAULT_REPEAT = 3;

export interface EvalArgs {
  /** Suites to run; empty runs every suite. */
  suites: string[];
  /** Write the result as the new baseline instead of comparing with it. */
  saveBaseline: boolean;
  concurrency: number;
  repeat: number;
  /**
   * The one provider the prompts run on, without fallback, so a result measures one model; the
   * judge stays on OpenAI.
   */
  provider: ModelProviderName;
}

function positiveInteger(name: string, value: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return number;
}

/**
 * `--suite intent[,other]` (repeatable), `--save-baseline`, `--concurrency 5`, `--repeat 3`,
 * `--provider deepseek` (openai by default).
 */
export function parseEvalArgs(argv: string[], known: string[]): EvalArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      suite: { type: 'string', multiple: true, default: [] },
      'save-baseline': { type: 'boolean', default: false },
      concurrency: { type: 'string', default: String(DEFAULT_CONCURRENCY) },
      repeat: { type: 'string', default: String(DEFAULT_REPEAT) },
      provider: { type: 'string', default: ModelProviderName.OpenAi },
    },
    strict: true,
  });

  const suites = [
    ...new Set(values.suite.flatMap((value) => value.split(',').map((name) => name.trim()))),
  ].filter((name) => name !== '');
  const unknown = suites.filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown suite: ${unknown.join(', ')}. Known: ${known.join(', ')}`);
  }

  const providers: string[] = Object.values(ModelProviderName);
  if (!providers.includes(values.provider)) {
    throw new Error(`Unknown provider: ${values.provider}. Known: ${providers.join(', ')}`);
  }

  return {
    suites,
    saveBaseline: values['save-baseline'],
    concurrency: positiveInteger('concurrency', values.concurrency),
    repeat: positiveInteger('repeat', values.repeat),
    provider: values.provider as ModelProviderName,
  };
}
