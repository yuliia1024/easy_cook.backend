/**
 * Runs the evals on the real model (OPEN_AI_API_KEY, costs money). Not part of `npm test` or CI.
 *
 *   npm run eval                                  # every suite, compared with its baseline
 *   npm run eval -- --suite intent                # one suite (comma separated or repeated)
 *   npm run eval -- --suite intent --save-baseline
 *   npm run eval -- --concurrency 3 --repeat 1   # 3 runs of every case by default
 *
 * Prints a summary per suite and writes the full report to evals/reports/ (git-ignored).
 * Exit code 1 when a suite is worse than its baseline in evals/baselines/.
 */
import 'dotenv/config';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { OpenAiConfigService } from '../src/configs/open-ai-config/open-ai-config.service';
import { OpenAiService } from '../src/providers/open-ai/open-ai.service';
import { parseEvalArgs } from './lib/args';
import { runEvals } from './lib/run-evals';
import { SUITES } from './suites';

async function main(): Promise<boolean> {
  const args = parseEvalArgs(
    process.argv.slice(2),
    SUITES.map((suite) => suite.name),
  );
  const apiKey = process.env.OPEN_AI_API_KEY;
  if (!apiKey) {
    throw new Error('OPEN_AI_API_KEY is not set (see .env.example)');
  }
  // Failed calls end up in the report; the per-call log lines would only bury the summary.
  Logger.overrideLogger(false);
  const openAi = new OpenAiService({ apiKey } as OpenAiConfigService);

  const { ok } = await runEvals(
    args,
    SUITES,
    openAi,
    { baselines: join(__dirname, 'baselines'), reports: join(__dirname, 'reports') },
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
