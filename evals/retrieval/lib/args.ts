import { parseArgs } from 'node:util';
import { EmbeddingProviderName, RecipeSearchMode } from '../../../src/common/constants';

export interface RetrievalArgs {
  /** The one model measured, without fallback. */
  provider: EmbeddingProviderName;
  /** Every mode when not given: hybrid against its two legs. */
  modes: RecipeSearchMode[];
  /** Only the cases with any of these tags; empty runs every case. */
  tags: string[];
  saveBaseline: boolean;
}

const listOf = (values: string[]): string[] =>
  [...new Set(values.flatMap((value) => value.split(',').map((name) => name.trim())))].filter(
    (name) => name !== '',
  );

function oneOf<T extends string>(name: string, value: string, allowed: readonly T[]): T {
  if (!allowed.includes(value as T)) {
    throw new Error(`--${name} must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

/** `--provider ollama|openai` (ollama by default), `--mode hybrid[,semantic]`, `--tag a,b`, `--save-baseline`. */
export function parseRetrievalArgs(argv: string[]): RetrievalArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      provider: { type: 'string', default: EmbeddingProviderName.Ollama },
      mode: { type: 'string', multiple: true, default: [] },
      tag: { type: 'string', multiple: true, default: [] },
      'save-baseline': { type: 'boolean', default: false },
    },
    strict: true,
  });
  const modes = listOf(values.mode).map((mode) =>
    oneOf('mode', mode, Object.values(RecipeSearchMode)),
  );
  return {
    provider: oneOf('provider', values.provider, Object.values(EmbeddingProviderName)),
    modes: modes.length > 0 ? modes : Object.values(RecipeSearchMode),
    tags: listOf(values.tag),
    saveBaseline: values['save-baseline'],
  };
}
