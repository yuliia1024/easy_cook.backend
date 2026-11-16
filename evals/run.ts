/**
 * Runs the evals on the real model (OPEN_AI_API_KEY; DEEPSEEK_API_KEY for `--provider deepseek`;
 * ANTHROPIC_API_KEY for the suites with a judge; costs money). Not part of `npm test` or CI.
 *
 *   npm run eval                                  # every suite, compared with its baseline
 *   npm run eval -- --suite intent                # one suite (comma separated or repeated)
 *   npm run eval -- --suite intent --save-baseline
 *   npm run eval -- --concurrency 3 --repeat 1   # 3 runs of every case by default
 *   npm run eval -- --provider deepseek          # the fallback model, its baselines in baselines/deepseek/
 *
 * Prints a summary per suite and writes the full report to evals/reports/ (git-ignored).
 * Exit code 1 when a suite is worse than its baseline in evals/baselines/ (of the provider).
 */
import 'dotenv/config';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { ModelProviderName } from '../src/common/constants';
import { ModelProvidersConfigService } from '../src/configs/model-providers-config/model-providers-config.service';
import { OpenAiService } from '../src/providers/open-ai/open-ai.service';
import { parseEvalArgs } from './lib/args';
import { baselinesDir } from './lib/baseline';
import { JUDGE_PROMPT_NAME } from './lib/judge';
import { runEvals } from './lib/run-evals';
import { SUITES } from './suites';

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
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || undefined;
  const judged = SUITES.filter(
    (suite) =>
      (args.suites.length === 0 || args.suites.includes(suite.name)) &&
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
  const openAi = new OpenAiService({
    openAiApiKey,
    deepSeekApiKey,
    anthropicApiKey,
    providers: [args.provider],
  } as ModelProvidersConfigService);

  const { ok } = await runEvals(
    args,
    SUITES,
    openAi,
    {
      baselines: baselinesDir(join(__dirname, 'baselines'), args.provider),
      reports: join(__dirname, 'reports'),
    },
    (line) => console.log(line),
  );
  return ok;
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
