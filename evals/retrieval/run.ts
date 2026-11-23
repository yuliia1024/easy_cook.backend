/**
 * Retrieval evals of the recipe search: every case of cases.jsonl searched in every mode (hybrid
 * and its two legs alone) against the seed catalog, scored with Recall@k, Precision@k, Hit@k,
 * MRR@k and nDCG@k (k = RETRIEVAL_K) from graded judgements. One model, no fallback, so a result
 * measures that model. Not part of `npm test`.
 *
 * Needs the seed catalog indexed by the model:
 *   npm run infra:up && npm run db:seed && npm run data:seed-recipes
 *   npm run infra:embeddings && npm run search:index
 *
 *   npm run eval:retrieval                          # the local model, every mode
 *   npm run eval:retrieval -- --provider openai     # OpenAI (EMBEDDING_PROVIDERS=openai npm run search:index first)
 *   npm run eval:retrieval -- --mode hybrid --tag uk
 *   npm run eval:retrieval -- --save-baseline
 *
 * Prints a table per mode, writes the per-case rankings to evals/reports/ (git-ignored).
 * Exit code 1 on a regression against evals/retrieval/baselines/<model>.json, a recipe that
 * breaks the filters of its case, or a search that lost its embedding model.
 */
import 'dotenv/config';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { RECIPE_DOCUMENT_VERSION } from '../../src/common/constants';
import { ConfigModule } from '../../src/configs/config.module';
import { RecipeIndexService } from '../../src/modules/services/recipe-search/recipe-index.service';
import { RecipeSearchModule } from '../../src/modules/services/recipe-search/recipe-search.module';
import { RecipeSearchService } from '../../src/modules/services/recipe-search/recipe-search.service';
import { PrismaModule } from '../../src/providers/prisma/prisma.module';
import { PrismaService } from '../../src/providers/prisma/prisma.service';
import { parseCases } from '../lib/cases';
import { parseRetrievalArgs } from './lib/args';
import {
  ABSENT_TAG,
  casesHash,
  compareWithRetrievalBaseline,
  filterViolations,
  formatSummaries,
  RankedRecipe,
  RETRIEVAL_K,
  RetrievalBaselineSchema,
  retrievalBaselineFile,
  RetrievalCaseResult,
  RetrievalCaseSchema,
  scoreRanking,
  summarizeMode,
  toRetrievalBaseline,
  toSearchFilters,
} from './lib/retrieval';

const CASES_FILE = join(__dirname, 'cases.jsonl');
const BASELINES_DIR = join(__dirname, 'baselines');
const REPORTS_DIR = join(__dirname, '..', 'reports');

@Module({ imports: [ConfigModule, PrismaModule, RecipeSearchModule] })
class RetrievalEvalModule {}

async function main(): Promise<boolean> {
  const args = parseRetrievalArgs(process.argv.slice(2));
  // One model, no fallback: the result must measure the model asked for.
  process.env.EMBEDDING_PROVIDERS = args.provider;
  Logger.overrideLogger(['error']);
  const app = await NestFactory.createApplicationContext(RetrievalEvalModule, {
    logger: ['error'],
  });
  try {
    const [status] = await app.get(RecipeIndexService).status();
    if (!status.complete) {
      throw new Error(
        `${status.model}: ${status.embedded}/${status.recipes} recipes embedded; run EMBEDDING_PROVIDERS=${args.provider} npm run search:index`,
      );
    }

    const text = readFileSync(CASES_FILE, 'utf8');
    const cases = parseCases(text, RetrievalCaseSchema, CASES_FILE).filter(
      ({ tags }) => args.tags.length === 0 || tags.some((tag) => args.tags.includes(tag)),
    );
    const slugs = [...new Set(cases.flatMap(({ relevant }) => Object.keys(relevant)))];
    const known = await app.get(PrismaService).recipe.findMany({
      where: { source: 'seed', sourceId: { in: slugs } },
      select: { sourceId: true },
    });
    const missing = slugs.filter((slug) => !known.some(({ sourceId }) => sourceId === slug));
    if (missing.length > 0) {
      throw new Error(`Cases name recipes the catalog does not have: ${missing.join(', ')}`);
    }

    const search = app.get(RecipeSearchService);
    const results: RetrievalCaseResult[] = [];
    for (const mode of args.modes) {
      // One by one: the latency is of a search, not of a queue.
      for (const testCase of cases) {
        const startedAt = performance.now();
        const { hits, degraded, matched } = await search.search({
          text: testCase.query,
          filters: toSearchFilters(testCase),
          limit: RETRIEVAL_K,
          mode,
        });
        const latencyMs = Math.round(performance.now() - startedAt);
        const ranked: RankedRecipe[] = hits.map(({ recipe }) => ({
          slug: recipe.sourceId ?? recipe.id,
          mealType: recipe.mealType,
          dietType: recipe.dietType,
          allergens: recipe.allergens,
          prepTimeMinutes: recipe.prepTimeMinutes,
        }));
        results.push({
          id: testCase.id,
          tags: testCase.tags,
          lang: testCase.lang,
          mode,
          ranked: ranked.map(({ slug }) => slug),
          metrics: scoreRanking(
            ranked.map(({ slug }) => slug),
            testCase.relevant,
          ),
          absent: testCase.tags.includes(ABSENT_TAG),
          matched,
          filterViolations: ranked.flatMap((recipe) => filterViolations(recipe, testCase)),
          degraded,
          latencyMs,
        });
      }
    }

    const summaries = args.modes.map((mode) => summarizeMode(mode, results));
    console.log(
      `${status.model}, document v${RECIPE_DOCUMENT_VERSION}, ${cases.length} cases, k=${RETRIEVAL_K}`,
    );
    formatSummaries(summaries).forEach((line) => console.log(line));

    mkdirSync(REPORTS_DIR, { recursive: true });
    const reportFile = join(
      REPORTS_DIR,
      `retrieval-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    );
    writeFileSync(
      reportFile,
      JSON.stringify(
        { model: status.model, documentVersion: RECIPE_DOCUMENT_VERSION, summaries, results },
        null,
        2,
      ),
    );
    console.log(`Report: ${reportFile}`);

    let ok = true;
    const violations = summaries.reduce((sum, { filterViolations: count }) => sum + count, 0);
    const degraded = summaries.reduce((sum, { degraded: count }) => sum + count, 0);
    if (violations > 0) {
      console.error(`FAIL: ${violations} returned recipes break the filters of their case`);
      ok = false;
    }
    if (degraded > 0) {
      console.error(
        `FAIL: ${degraded} searches lost the embedding model; the result is not of ${status.model}`,
      );
      ok = false;
    }

    const current = {
      model: status.model,
      documentVersion: RECIPE_DOCUMENT_VERSION,
      casesHash: casesHash(text),
    };
    const baselineFile = join(BASELINES_DIR, retrievalBaselineFile(status.model));
    if (args.saveBaseline) {
      if (args.tags.length > 0 || args.modes.length < 3) {
        throw new Error('A baseline is of every case in every mode: drop --tag and --mode');
      }
      mkdirSync(BASELINES_DIR, { recursive: true });
      const baseline = toRetrievalBaseline(
        status.model,
        RECIPE_DOCUMENT_VERSION,
        current.casesHash,
        summaries,
        new Date(),
      );
      writeFileSync(baselineFile, `${JSON.stringify(baseline, null, 2)}\n`);
      console.log(`Baseline saved: ${baselineFile}`);
      return ok;
    }
    let baselineText: string;
    try {
      baselineText = readFileSync(baselineFile, 'utf8');
    } catch {
      console.log(`No baseline for ${status.model}: save one with --save-baseline`);
      return ok;
    }
    const baseline = RetrievalBaselineSchema.parse(JSON.parse(baselineText));
    // A subset of the cases is not comparable with a baseline of all of them.
    const comparison = compareWithRetrievalBaseline(
      baseline,
      args.tags.length > 0 ? { ...current, casesHash: 'subset' } : current,
      summaries,
    );
    if (comparison.stale) {
      console.log(`Not compared: ${comparison.stale}; save a new one with --save-baseline`);
      return ok;
    }
    for (const { mode, metric, baseline: before, actual } of comparison.regressions) {
      console.error(
        `REGRESSION ${mode} ${metric}: ${actual.toFixed(3)} < baseline ${before.toFixed(3)}`,
      );
    }
    if (comparison.regressions.length === 0) {
      console.log('No regression against the baseline');
    }
    return ok && comparison.regressions.length === 0;
  } finally {
    await app.close();
  }
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
