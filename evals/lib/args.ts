import { parseArgs } from 'node:util';
import { ModelProviderName } from '../../src/common/constants';

export const DEFAULT_CONCURRENCY = 5;
/** Runs of every case; the rates average them, so one lucky or unlucky answer moves them less. */
export const DEFAULT_REPEAT = 3;

export interface EvalArgs {
  /** Suites to run; empty runs every suite. */
  suites: string[];
  /**
   * Runs only the cases with any of these tags and compares only their tag rates with the
   * baseline; empty runs every case.
   */
  tags: string[];
  /**
   * A git ref: runs only the suites and tags the changes since it touch (`evals/suites/triggers.ts`)
   * or whose prompt versions differ from the baseline.
   */
  changedSince: string | null;
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

/** `--suite a,b` and `--tag a,b` (both repeatable): the names without blanks and duplicates. */
const listOf = (values: string[]): string[] =>
  [...new Set(values.flatMap((value) => value.split(',').map((name) => name.trim())))].filter(
    (name) => name !== '',
  );

/**
 * `--suite intent[,other]` (repeatable), `--tag save[,other]` (repeatable),
 * `--changed-since origin/main`, `--save-baseline`, `--concurrency 5`, `--repeat 3`,
 * `--provider deepseek` (openai by default).
 */
export function parseEvalArgs(argv: string[], known: string[]): EvalArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      suite: { type: 'string', multiple: true, default: [] },
      tag: { type: 'string', multiple: true, default: [] },
      'changed-since': { type: 'string' },
      'save-baseline': { type: 'boolean', default: false },
      concurrency: { type: 'string', default: String(DEFAULT_CONCURRENCY) },
      repeat: { type: 'string', default: String(DEFAULT_REPEAT) },
      provider: { type: 'string', default: ModelProviderName.OpenAi },
    },
    strict: true,
  });

  const suites = listOf(values.suite);
  const tags = listOf(values.tag);
  const changedSince = values['changed-since']?.trim() || null;
  const unknown = suites.filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown suite: ${unknown.join(', ')}. Known: ${known.join(', ')}`);
  }

  const providers: string[] = Object.values(ModelProviderName);
  if (!providers.includes(values.provider)) {
    throw new Error(`Unknown provider: ${values.provider}. Known: ${providers.join(', ')}`);
  }

  if (changedSince && (suites.length > 0 || tags.length > 0)) {
    throw new Error('--changed-since picks the suites and tags itself; drop --suite and --tag');
  }
  if (values['save-baseline'] && (tags.length > 0 || changedSince)) {
    throw new Error('--save-baseline records whole suites; drop --tag and --changed-since');
  }

  return {
    suites,
    tags,
    changedSince,
    saveBaseline: values['save-baseline'],
    concurrency: positiveInteger('concurrency', values.concurrency),
    repeat: positiveInteger('repeat', values.repeat),
    provider: values.provider as ModelProviderName,
  };
}
