import { promptLabel } from '../../src/common/utils';
import { EvalArgs } from './args';
import { Baseline } from './baseline';
import { EvalSuite } from './types';

/** Every suite, in `EvalTrigger.suites`. */
export const ALL_SUITES = '*';

/** Code an eval result depends on: a change under one of `paths` runs these suites (or tags). */
export interface EvalTrigger {
  /** Path prefixes from the repository root: a folder ends with `/`. */
  paths: string[];
  suites: string[] | typeof ALL_SUITES;
  /** Only the cases with any of these tags; absent runs every case of the suites. */
  tags?: string[];
}

/** One suite of a run: the cases with any of `tags`, every case when empty. */
export interface SuitePlan {
  suite: string;
  tags: string[];
  /** Why the suite runs, for the log: the changed files or prompt versions. */
  reasons: string[];
}

/** `--suite` / `--tag`: the chosen suites (every suite when none), each filtered by the tags. */
export function planFromArgs(args: EvalArgs, suites: EvalSuite[]): SuitePlan[] {
  return suites
    .filter((suite) => args.suites.length === 0 || args.suites.includes(suite.name))
    .map((suite) => ({ suite: suite.name, tags: args.tags, reasons: [] }));
}

/** What the run on `model` would compare with: the suite runs whole when it no longer matches. */
function baselineReason(suite: EvalSuite, baseline: Baseline | null, model: string): string | null {
  if (!baseline) {
    return null;
  }
  const prompts = suite.prompts.map(promptLabel);
  if (baseline.prompts.join() !== prompts.join()) {
    return `prompts ${baseline.prompts.join(', ')} -> ${prompts.join(', ')}`;
  }
  if (!baseline.models.includes(model)) {
    return `model ${baseline.models.join(', ')} -> ${model}`;
  }
  return null;
}

const isSpec = (file: string): boolean => /\.(e2e-)?spec\.ts$/.test(file);

/**
 * The suites the changed files touch: a suite runs whole when a trigger without tags or its own
 * folder under `evals/suites/` matches, or when its prompt versions or `model` differ from its
 * baseline; otherwise only the tags of the matching triggers. Specs change no result.
 */
export function planFromChanges(
  changedFiles: string[],
  suites: EvalSuite[],
  triggers: EvalTrigger[],
  baselineOf: (suite: string) => Baseline | null,
  model: string,
): SuitePlan[] {
  const files = changedFiles.filter((file) => !isSpec(file));
  const plans = new Map<string, { whole: boolean; tags: Set<string>; reasons: Set<string> }>();
  const add = (suite: string, tags: string[] | undefined, reason: string): void => {
    const plan = plans.get(suite) ?? { whole: false, tags: new Set(), reasons: new Set() };
    plan.whole ||= !tags || tags.length === 0;
    tags?.forEach((tag) => plan.tags.add(tag));
    plan.reasons.add(reason);
    plans.set(suite, plan);
  };

  for (const trigger of triggers) {
    const touched = files.filter((file) => trigger.paths.some((path) => file.startsWith(path)));
    if (touched.length === 0) {
      continue;
    }
    const names =
      trigger.suites === ALL_SUITES ? suites.map((suite) => suite.name) : trigger.suites;
    names.forEach((name) => touched.forEach((file) => add(name, trigger.tags, file)));
  }
  for (const suite of suites) {
    files
      .filter((file) => file.startsWith(`evals/suites/${suite.name}/`))
      .forEach((file) => add(suite.name, undefined, file));
    const reason = baselineReason(suite, baselineOf(suite.name), model);
    if (reason) {
      add(suite.name, undefined, reason);
    }
  }

  return suites
    .filter((suite) => plans.has(suite.name))
    .map((suite) => {
      const { whole, tags, reasons } = plans.get(suite.name)!;
      return { suite: suite.name, tags: whole ? [] : [...tags].sort(), reasons: [...reasons] };
    });
}
