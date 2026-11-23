import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Allergen, DietTag, MealType, RecipeSearchMode } from '../../../src/common/constants';
import { RecipeSearchFilters } from '../../../src/common/types';
import { dietTagsSatisfying } from '../../../src/modules/services/menu/menu-rules';
import { EvalCaseSchema, LatencyStats } from '../../lib/types';
import { latencyStats } from '../../lib/summary';
import { hitAtK, ndcgAtK, precisionAtK, recallAtK, reciprocalRankAtK, Relevance } from './metrics';

/** The tag of a case the catalog has no answer to. */
export const ABSENT_TAG = 'absent';

/** The depth every metric is measured at, and the hits a search returns in the evals. */
export const RETRIEVAL_K = 10;
/** A mean metric of a mode may drop this much below the baseline before it is a regression. */
export const RETRIEVAL_TOLERANCE = 0.02;

/**
 * A query as a user would type it (`lang` - en / uk: a recipe document has its English text
 * and the Ukrainian translation), the structured filters the app would pass, and the graded
 * judgements by seed slug: 2 - exactly what was asked, 1 - fits. Unlisted recipes count as not
 * relevant, so `relevant` lists every recipe of the catalog that fits. A case tagged `absent` asks
 * for what the catalog does not have ("sushi"): no relevant recipe, and the search must not say it
 * matched (`RecipeSearchResult.matched`).
 */
export const RetrievalCaseSchema = EvalCaseSchema.extend({
  query: z.string().trim().min(1),
  lang: z.enum(['en', 'uk']).default('en'),
  filters: z
    .object({
      mealType: z.enum(MealType).optional(),
      diets: z.array(z.enum(DietTag)).optional(),
      excludeAllergens: z.array(z.enum(Allergen)).optional(),
      maxPrepTimeMinutes: z.number().int().positive().optional(),
    })
    .strict()
    .default({}),
  relevant: z.record(z.string().min(1), z.union([z.literal(1), z.literal(2)])),
}).refine(
  ({ relevant, tags }) => (Object.keys(relevant).length === 0) === tags.includes(ABSENT_TAG),
  'a relevant recipe, or none for a case tagged absent',
);

export type RetrievalCase = z.infer<typeof RetrievalCaseSchema>;

/** The filters of a case as `RecipeSearchService` takes them. */
export function toSearchFilters({ filters }: RetrievalCase): RecipeSearchFilters {
  return {
    mealType: filters.mealType,
    dietTypeGroups: filters.diets?.map((diet) => [...dietTagsSatisfying(diet)]),
    excludeAllergens: filters.excludeAllergens,
    maxPrepTimeMinutes: filters.maxPrepTimeMinutes,
  };
}

/** What the evals know of a returned recipe. */
export interface RankedRecipe {
  slug: string;
  mealType: string;
  dietType: string[];
  allergens: string[];
  prepTimeMinutes: number | null;
}

/** Why a returned recipe breaks the filters of its case; empty when it does not. */
export function filterViolations(recipe: RankedRecipe, { filters }: RetrievalCase): string[] {
  const violations: string[] = [];
  if (filters.mealType && recipe.mealType !== filters.mealType) {
    violations.push(`${recipe.slug}: meal ${recipe.mealType}`);
  }
  for (const diet of filters.diets ?? []) {
    if (!dietTagsSatisfying(diet).some((tag) => recipe.dietType.includes(tag))) {
      violations.push(`${recipe.slug}: not ${diet}`);
    }
  }
  for (const allergen of filters.excludeAllergens ?? []) {
    if (recipe.allergens.includes(allergen)) {
      violations.push(`${recipe.slug}: contains ${allergen}`);
    }
  }
  if (
    filters.maxPrepTimeMinutes !== undefined &&
    (recipe.prepTimeMinutes === null || recipe.prepTimeMinutes > filters.maxPrepTimeMinutes)
  ) {
    violations.push(`${recipe.slug}: ${recipe.prepTimeMinutes ?? '?'} min`);
  }
  return violations;
}

export const METRICS = [
  'recall@5',
  'recall@10',
  'precision@5',
  'hit@3',
  'mrr@10',
  'ndcg@10',
] as const;
export type MetricName = (typeof METRICS)[number];
export type MetricValues = Record<MetricName, number>;
/**
 * `match`: the share of the cases with answers the search said it matched; `no-match`: of the
 * `absent` cases, the share it did not (it found only similar recipes, as it should).
 */
export const MATCH_METRICS = ['match', 'no-match'] as const;
export type SummaryMetricName = MetricName | (typeof MATCH_METRICS)[number];

export function scoreRanking(ranked: string[], relevance: Relevance): MetricValues {
  return {
    'recall@5': recallAtK(ranked, relevance, 5),
    'recall@10': recallAtK(ranked, relevance, 10),
    'precision@5': precisionAtK(ranked, relevance, 5),
    'hit@3': hitAtK(ranked, relevance, 3),
    'mrr@10': reciprocalRankAtK(ranked, relevance, 10),
    'ndcg@10': ndcgAtK(ranked, relevance, 10),
  };
}

/** One case searched in one mode. */
export interface RetrievalCaseResult {
  id: string;
  tags: string[];
  lang: string;
  mode: RecipeSearchMode;
  /** Slugs in the returned order. */
  ranked: string[];
  /** Zero for an `absent` case, left out of the means. */
  metrics: MetricValues;
  /** The catalog has no answer (`ABSENT_TAG`). */
  absent: boolean;
  /** `RecipeSearchResult.matched`. */
  matched: boolean;
  filterViolations: string[];
  /** The search fell back to full-text: every embedding provider failed. */
  degraded: boolean;
  latencyMs: number;
}

export interface ModeSummary {
  mode: RecipeSearchMode;
  cases: number;
  /** Means over the cases with answers, to 3 decimals, and the match rates. */
  metrics: Record<SummaryMetricName, number>;
  byTag: Record<string, MetricValues>;
  byLang: Record<string, MetricValues>;
  filterViolations: number;
  degraded: number;
  latency: LatencyStats;
}

const round = (value: number): number => Math.round(value * 1000) / 1000;

function meanMetrics(results: RetrievalCaseResult[]): MetricValues {
  return Object.fromEntries(
    METRICS.map((metric) => [
      metric,
      results.length === 0
        ? 0
        : round(results.reduce((sum, result) => sum + result.metrics[metric], 0) / results.length),
    ]),
  ) as MetricValues;
}

function groupMeans(
  results: RetrievalCaseResult[],
  keysOf: (result: RetrievalCaseResult) => string[],
): Record<string, MetricValues> {
  const groups = new Map<string, RetrievalCaseResult[]>();
  for (const result of results) {
    for (const key of keysOf(result)) {
      groups.set(key, [...(groups.get(key) ?? []), result]);
    }
  }
  return Object.fromEntries(
    [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, group]) => [key, meanMetrics(group)]),
  );
}

const share = (
  results: RetrievalCaseResult[],
  pass: (result: RetrievalCaseResult) => boolean,
): number => (results.length === 0 ? 0 : round(results.filter(pass).length / results.length));

export function summarizeMode(mode: RecipeSearchMode, results: RetrievalCaseResult[]): ModeSummary {
  const ofMode = results.filter((result) => result.mode === mode);
  const answered = ofMode.filter(({ absent }) => !absent);
  return {
    mode,
    cases: ofMode.length,
    metrics: {
      ...meanMetrics(answered),
      match: share(answered, ({ matched }) => matched),
      'no-match': share(
        ofMode.filter(({ absent }) => absent),
        ({ matched }) => !matched,
      ),
    },
    byTag: groupMeans(answered, ({ tags }) => tags),
    byLang: groupMeans(answered, ({ lang }) => [lang]),
    filterViolations: ofMode.reduce((sum, result) => sum + result.filterViolations.length, 0),
    degraded: ofMode.filter(({ degraded }) => degraded).length,
    latency: latencyStats(ofMode.map(({ latencyMs }) => latencyMs)),
  };
}

/** sha256 of the cases file: a baseline measured on other cases is not comparable. */
export const casesHash = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, 16);

export const RetrievalBaselineSchema = z.object({
  model: z.string(),
  documentVersion: z.number().int(),
  casesHash: z.string(),
  createdAt: z.string(),
  modes: z.record(z.string(), z.record(z.string(), z.number())),
});

export type RetrievalBaseline = z.infer<typeof RetrievalBaselineSchema>;

export function toRetrievalBaseline(
  model: string,
  documentVersion: number,
  hash: string,
  summaries: ModeSummary[],
  now: Date,
): RetrievalBaseline {
  return {
    model,
    documentVersion,
    casesHash: hash,
    createdAt: now.toISOString(),
    modes: Object.fromEntries(summaries.map(({ mode, metrics }) => [mode, { ...metrics }])),
  };
}

export interface RetrievalComparison {
  /** Why the baseline cannot be compared (another model, document version or cases); null when it can. */
  stale: string | null;
  regressions: Array<{ mode: string; metric: string; baseline: number; actual: number }>;
}

/** A metric of a mode the baseline has that fell more than `RETRIEVAL_TOLERANCE` below it. */
export function compareWithRetrievalBaseline(
  baseline: RetrievalBaseline,
  current: { model: string; documentVersion: number; casesHash: string },
  summaries: ModeSummary[],
): RetrievalComparison {
  const stale =
    baseline.model !== current.model
      ? `baseline of ${baseline.model}`
      : baseline.documentVersion !== current.documentVersion
        ? `baseline of document version ${baseline.documentVersion}`
        : baseline.casesHash !== current.casesHash
          ? 'baseline of other cases'
          : null;
  if (stale) {
    return { stale, regressions: [] };
  }
  const regressions = summaries.flatMap(({ mode, metrics }) =>
    Object.entries(baseline.modes[mode] ?? {})
      .filter(([metric, value]) => {
        const actual = metrics[metric as SummaryMetricName];
        return actual !== undefined && actual < value - RETRIEVAL_TOLERANCE;
      })
      .map(([metric, value]) => ({
        mode,
        metric,
        baseline: value,
        actual: metrics[metric as SummaryMetricName],
      })),
  );
  return { stale: null, regressions };
}

/** `ollama/qwen3-embedding:0.6b-q8_0@1024` -> a file name. */
export const retrievalBaselineFile = (model: string): string =>
  `${model.replace(/[^a-zA-Z0-9.@-]+/g, '_')}.json`;

/** The table printed after a run: one line per mode, then the per-language and per-tag nDCG. */
export function formatSummaries(summaries: ModeSummary[]): string[] {
  const lines = [
    `mode      cases  ${[...METRICS, ...MATCH_METRICS].map((metric) => metric.padStart(12)).join('')}  p50ms  p95ms  violations  degraded`,
  ];
  for (const summary of summaries) {
    lines.push(
      `${summary.mode.padEnd(9)} ${String(summary.cases).padStart(5)}  ${[
        ...METRICS,
        ...MATCH_METRICS,
      ]
        .map((metric) => summary.metrics[metric].toFixed(3).padStart(12))
        .join(
          '',
        )}  ${String(summary.latency.p50Ms).padStart(5)}  ${String(summary.latency.p95Ms).padStart(5)}  ${String(summary.filterViolations).padStart(10)}  ${String(summary.degraded).padStart(8)}`,
    );
  }
  for (const summary of summaries) {
    const groups = { ...summary.byLang, ...summary.byTag };
    lines.push(
      `${summary.mode} ndcg@10: ${Object.entries(groups)
        .map(([key, metrics]) => `${key} ${metrics['ndcg@10'].toFixed(2)}`)
        .join(', ')}`,
    );
  }
  return lines;
}
