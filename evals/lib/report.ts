import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BaselineComparison } from './baseline';
import { CaseResult, Rate, SuiteSummary } from './types';

export interface SuiteReport {
  summary: SuiteSummary;
  /** Null when the suite has no baseline yet or the run saved a new one. */
  baseline: BaselineComparison | null;
  results: CaseResult[];
}

/** Everything a run produced; written to `evals/reports/` as JSON. */
export interface EvalReport {
  startedAt: string;
  durationMs: number;
  suites: SuiteReport[];
}

const percent = ({ rate }: Rate): string => `${(rate * 100).toFixed(1)}%`;
const ratio = (value: Rate): string => `${percent(value)} (${value.passed}/${value.total})`;
const usd = (value: number | null): string =>
  value === null ? 'unknown (no price for the model)' : `$${value.toFixed(4)}`;

/** The console summary of a suite: rates, failed cases, tokens, latency, cost, baseline. */
export function formatSuite({ summary, baseline, results }: SuiteReport): string[] {
  const { usage, latency } = summary;
  const lines = [
    `Suite ${summary.suite} (${summary.models.join(', ') || 'no model answered'})`,
    `  pass rate  ${ratio(summary.cases)}${
      summary.invalidOutputs ? `, ${summary.invalidOutputs} invalid outputs` : ''
    }`,
    ...(summary.failedCalls
      ? [`  calls      ${summary.failedCalls} failed, left out of the rates and latency`]
      : []),
    ...Object.entries(summary.fields).map(
      ([field, value]) => `  field      ${field.padEnd(14)} ${ratio(value)}`,
    ),
    ...Object.entries(summary.tags).map(
      ([tag, value]) => `  tag        ${tag.padEnd(14)} ${ratio(value)}`,
    ),
    `  tokens     ${usage.inputTokens} in (${usage.cachedInputTokens} cached) + ${usage.outputTokens} out`,
    `  latency    mean ${latency.meanMs}ms, p50 ${latency.p50Ms}ms, p95 ${latency.p95Ms}ms, max ${latency.maxMs}ms`,
    `  cost       ${usd(summary.costUsd)}`,
  ];

  const failed = results.filter((result) => !result.pass);
  if (failed.length > 0) {
    lines.push('  failed');
    for (const result of failed) {
      const reason =
        result.error?.message ??
        result.fields
          .filter((field) => !field.pass)
          .map(
            (field) =>
              `${field.field}: expected ${JSON.stringify(field.expected)}, got ${JSON.stringify(field.actual)}`,
          )
          .join('; ');
      lines.push(`    ${result.id}#${result.attempt}: ${reason}`);
    }
  }

  if (baseline?.modelMismatch) {
    lines.push(
      `  baseline   OTHER MODEL: ${baseline.modelMismatch.current.join(', ') || 'none'} vs ` +
        `${baseline.modelMismatch.baseline.join(', ')}; save a new baseline with --save-baseline`,
    );
  } else if (baseline) {
    lines.push(
      baseline.regressions.length === 0
        ? '  baseline   not worse'
        : `  baseline   WORSE: ${baseline.regressions
            .map(
              ({ metric, baseline: base, current }) =>
                `${metric} ${(current * 100).toFixed(1)}% < ${(base * 100).toFixed(1)}%`,
            )
            .join(', ')}`,
    );
  }
  if (baseline && baseline.newlyFailed.length > 0) {
    lines.push(`  newly failed ${baseline.newlyFailed.join(', ')}`);
  }
  return lines;
}

/** Writes the report as `<dir>/<startedAt>.json` and returns the path. */
export function writeReport(dir: string, report: EvalReport): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${report.startedAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  return file;
}
