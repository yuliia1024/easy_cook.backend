import { OpenAiService } from '../../src/providers/open-ai/open-ai.service';
import { compareWithBaseline, readBaseline, toBaseline, writeBaseline } from './baseline';
import { loadCases } from './cases';
import { EvalReport, formatSuite, SuiteReport, writeReport } from './report';
import { runSuite } from './runner';
import { summarize } from './summary';
import { EvalArgs } from './args';
import { EvalSuite } from './types';

/**
 * Share of failed calls (timeouts, rate limits) above which the rest is too small to compare with
 * the baseline; the run fails as incomplete, not as worse.
 */
export const MAX_FAILED_CALLS_SHARE = 0.1;

export interface EvalDirs {
  baselines: string;
  reports: string;
}

export interface EvalOutcome {
  /**
   * False when a suite is worse than its baseline, ran on other models, lost too many calls, or
   * its baseline could not be saved.
   */
  ok: boolean;
  reportFile: string;
}

/**
 * Runs the chosen suites on the real model one after another, prints a summary per suite, writes
 * the full report and either saves each result as the baseline or compares it with the baseline.
 * A baseline is saved only from a run without failed calls.
 */
export async function runEvals(
  args: EvalArgs,
  suites: EvalSuite[],
  openAi: OpenAiService,
  dirs: EvalDirs,
  log: (line: string) => void,
  now: () => Date = () => new Date(),
): Promise<EvalOutcome> {
  const startedAt = now();
  const chosen = suites.filter(
    (suite) => args.suites.length === 0 || args.suites.includes(suite.name),
  );
  const reports: SuiteReport[] = [];
  let ok = true;

  for (const suite of chosen) {
    const cases = loadCases(suite.casesFile, suite.caseSchema);
    log(`Running ${suite.name}: ${cases.length} cases x ${args.repeat}`);
    const results = await runSuite(suite, cases, openAi, args);
    const summary = summarize(suite.name, results);

    const report: SuiteReport = { summary, baseline: null, results };
    const messages: string[] = [];
    if (args.saveBaseline) {
      if (summary.failedCalls > 0) {
        ok = false;
        messages.push(
          `Baseline not saved: ${summary.failedCalls} calls failed; run ${suite.name} again`,
        );
      } else {
        const file = writeBaseline(dirs.baselines, toBaseline(summary, results, now()));
        messages.push(`Baseline saved: ${file}`);
      }
    } else {
      const baseline = readBaseline(dirs.baselines, suite.name);
      if (baseline) {
        report.baseline = compareWithBaseline(summary, results, baseline);
        ok &&= report.baseline.regressions.length === 0 && !report.baseline.modelMismatch;
      } else {
        messages.push(`No baseline for ${suite.name}; save one with --save-baseline`);
      }
      if (summary.failedCalls > MAX_FAILED_CALLS_SHARE * results.length) {
        ok = false;
        messages.push(
          `Incomplete: ${summary.failedCalls} of ${results.length} calls failed; run ${suite.name} again`,
        );
      }
    }

    formatSuite(report).forEach((line) => log(line));
    messages.forEach((line) => log(line));
    reports.push(report);
  }

  const report: EvalReport = {
    startedAt: startedAt.toISOString(),
    durationMs: now().getTime() - startedAt.getTime(),
    suites: reports,
  };
  const reportFile = writeReport(dirs.reports, report);
  log(`Report: ${reportFile}`);
  return { ok, reportFile };
}
