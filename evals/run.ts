/**
 * Runs the evals on the real model (OPEN_AI_API_KEY; DEEPSEEK_API_KEY for `--provider deepseek`;
 * ANTHROPIC_API_KEY for the suites with a judge; costs money). Not part of `npm test`; CI runs it
 * with `--changed-since` (`.github/workflows/evals.yml`).
 *
 *   npm run eval                                  # every suite, compared with its baseline
 *   npm run eval -- --suite intent                # one suite (comma separated or repeated)
 *   npm run eval -- --suite intent --save-baseline
 *   npm run eval -- --suite chat-tools --tag save # the cases with any of the tags
 *   npm run eval -- --changed-since origin/main   # what the changes touch (evals/suites/triggers.ts)
 *   npm run eval -- --concurrency 3 --repeat 1   # 3 runs of every case by default
 *   npm run eval -- --provider deepseek          # the fallback model, its baselines in baselines/deepseek/
 *
 * Prints a summary per suite and writes the full report to evals/reports/ (git-ignored).
 * Exit code 1 when a suite is worse than its baseline in evals/baselines/ (of the provider).
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { ModelProviderName } from '../src/common/constants';
import { ModelProvidersConfigService } from '../src/configs/model-providers-config/model-providers-config.service';
import { LlmService } from '../src/providers/llm/llm.service';
import { MODEL_VENDORS } from '../src/providers/llm/vendors';
import { parseEvalArgs } from './lib/args';
import { baselinesDir, readBaseline } from './lib/baseline';
import { JUDGE_PROMPT_NAME } from './lib/judge';
import { planFromArgs, planFromChanges, SuitePlan } from './lib/plan';
import { runEvals } from './lib/run-evals';
import { SUITES } from './suites';
import { EVAL_TRIGGERS } from './suites/triggers';

/** Files changed between `ref` and the working tree, committed or not, from the repository root. */
function changedFiles(ref: string): string[] {
  const base = execFileSync('git', ['merge-base', ref, 'HEAD'], { encoding: 'utf8' }).trim();
  return execFileSync('git', ['diff', '--name-only', base], { encoding: 'utf8' })
    .split('\n')
    .filter((file) => file !== '');
}

async function main(): Promise<boolean> {
  const args = parseEvalArgs(
    process.argv.slice(2),
    SUITES.map((suite) => suite.name),
  );
  const openAiApiKey = process.env.OPEN_AI_API_KEY;
  if (!openAiApiKey) {
    throw new Error('OPEN_AI_API_KEY is not set (see .env.example)');
  }
  const deepSeekApiKey = process.env.DEEPSEEK_API_KEY || undefined;
  if (args.provider === ModelProviderName.DeepSeek && !deepSeekApiKey) {
    throw new Error('DEEPSEEK_API_KEY is not set (see .env.example)');
  }
  const baselines = baselinesDir(join(__dirname, 'baselines'), args.provider);
  const plan: SuitePlan[] = args.changedSince
    ? planFromChanges(
        changedFiles(args.changedSince),
        SUITES,
        EVAL_TRIGGERS,
        (suite) => readBaseline(baselines, suite),
        MODEL_VENDORS[args.provider].model,
      )
    : planFromArgs(args, SUITES);
  if (plan.length === 0) {
    console.log(`No eval to run: nothing since ${args.changedSince} touches a suite`);
    return true;
  }
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || undefined;
  const judged = SUITES.filter(
    (suite) =>
      plan.some((entry) => entry.suite === suite.name) &&
      suite.prompts.some((prompt) => prompt.name === JUDGE_PROMPT_NAME),
  );
  if (judged.length > 0 && !anthropicApiKey) {
    throw new Error(
      `ANTHROPIC_API_KEY is not set (see .env.example); the judge of ${judged.map((s) => s.name).join(', ')} runs on Claude`,
    );
  }
  // Failed calls end up in the report; the per-call log lines would only bury the summary.
  Logger.overrideLogger(false);
  // One provider, no fallback: a result measures one model.
  const llm = new LlmService({
    openAiApiKey,
    deepSeekApiKey,
    anthropicApiKey,
    providers: [args.provider],
  } as ModelProvidersConfigService);

  const { ok } = await runEvals(
    args,
    SUITES,
    llm,
    { baselines, reports: join(__dirname, 'reports') },
    (line) => console.log(line),
    undefined,
    plan,
  );
  return ok;
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
