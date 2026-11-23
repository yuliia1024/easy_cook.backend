import { RecipeSearchMode } from '../../../src/common/constants';
import { parseCases } from '../../lib/cases';
import {
  casesHash,
  compareWithRetrievalBaseline,
  filterViolations,
  formatSummaries,
  RankedRecipe,
  RetrievalCase,
  RetrievalCaseResult,
  RetrievalCaseSchema,
  retrievalBaselineFile,
  scoreRanking,
  summarizeMode,
  toRetrievalBaseline,
  toSearchFilters,
} from './retrieval';

const parse = (line: object): RetrievalCase =>
  parseCases(JSON.stringify(line), RetrievalCaseSchema, 'cases.jsonl')[0];

const result = (overrides: Partial<RetrievalCaseResult> = {}): RetrievalCaseResult => ({
  id: 'c',
  tags: ['soup'],
  lang: 'en',
  mode: RecipeSearchMode.Hybrid,
  ranked: ['a'],
  metrics: scoreRanking(['a'], { a: 2 }),
  absent: false,
  matched: true,
  filterViolations: [],
  degraded: false,
  latencyMs: 10,
  ...overrides,
});

describe('RetrievalCaseSchema', () => {
  it('defaults the language, tags and filters', () => {
    expect(parse({ id: 'c', query: 'soup', relevant: { a: 2 } })).toEqual({
      id: 'c',
      tags: [],
      query: 'soup',
      lang: 'en',
      filters: {},
      relevant: { a: 2 },
    });
  });

  it.each([
    [{ id: 'c', query: 'soup', relevant: {} }, 'a relevant recipe'],
    [
      { id: 'c', query: 'sushi', tags: ['absent'], relevant: { a: 1 } },
      'none for a case tagged absent',
    ],
    [{ id: 'c', query: 'soup', relevant: { a: 3 } }, 'relevant'],
    [{ id: 'c', query: 'soup', relevant: { a: 1 }, filters: { mealType: 'brunch' } }, 'mealType'],
    [{ id: 'c', query: 'soup', relevant: { a: 1 }, filters: { calories: 1 } }, 'calories'],
  ])('rejects %p', (line, message) => {
    expect(() => parse(line)).toThrow(message);
  });

  it('takes a case tagged absent without relevant recipes', () => {
    expect(parse({ id: 'c', query: 'sushi', tags: ['absent'], relevant: {} }).relevant).toEqual({});
  });
});

describe('toSearchFilters', () => {
  it('turns a diet into the tags that satisfy it', () => {
    const testCase = parse({
      id: 'c',
      query: 'soup',
      relevant: { a: 1 },
      filters: { mealType: 'lunch', diets: ['vegetarian'], excludeAllergens: ['milk'] },
    });

    expect(toSearchFilters(testCase)).toEqual({
      mealType: 'lunch',
      dietTypeGroups: [['vegetarian', 'vegan']],
      excludeAllergens: ['milk'],
      maxPrepTimeMinutes: undefined,
    });
  });
});

describe('filterViolations', () => {
  const recipe: RankedRecipe = {
    slug: 'r',
    mealType: 'dinner',
    dietType: ['vegan'],
    allergens: ['soy'],
    prepTimeMinutes: null,
  };

  it('is empty for a recipe that fits', () => {
    const testCase = parse({
      id: 'c',
      query: 'q',
      relevant: { a: 1 },
      filters: { mealType: 'dinner', diets: ['vegetarian'], excludeAllergens: ['milk'] },
    });

    expect(filterViolations(recipe, testCase)).toEqual([]);
  });

  it('names every broken filter; an unknown time is not quick', () => {
    const testCase = parse({
      id: 'c',
      query: 'q',
      relevant: { a: 1 },
      filters: {
        mealType: 'lunch',
        diets: ['pescatarian', 'high_protein'],
        excludeAllergens: ['soy'],
        maxPrepTimeMinutes: 20,
      },
    });

    expect(filterViolations(recipe, testCase)).toEqual([
      'r: meal dinner',
      'r: not high_protein',
      'r: contains soy',
      'r: ? min',
    ]);
  });
});

describe('summarizeMode', () => {
  it('averages the metrics of the mode, per tag and language, and counts the violations', () => {
    const summary = summarizeMode(RecipeSearchMode.Hybrid, [
      result({ id: 'a', metrics: scoreRanking(['a'], { a: 2 }) }),
      result({
        id: 'b',
        lang: 'uk',
        tags: ['fish'],
        metrics: scoreRanking(['z'], { a: 2 }),
        filterViolations: ['z: meal lunch'],
        degraded: true,
        latencyMs: 30,
      }),
      result({ mode: RecipeSearchMode.Lexical }),
    ]);

    expect(summary).toMatchObject({
      mode: RecipeSearchMode.Hybrid,
      cases: 2,
      filterViolations: 1,
      degraded: 1,
      latency: { p50Ms: 10, maxMs: 30 },
    });
    expect(summary.metrics['ndcg@10']).toBe(0.5);
    expect(summary.byLang.uk['ndcg@10']).toBe(0);
    expect(summary.byTag.soup['hit@3']).toBe(1);
    expect(formatSummaries([summary])[1]).toMatch(/^hybrid\s+2\s+/);
  });

  it('leaves the absent cases out of the means and rates the matches of both kinds', () => {
    const absent = { absent: true, metrics: scoreRanking(['a'], {}), tags: ['absent'] };
    const summary = summarizeMode(RecipeSearchMode.Hybrid, [
      result({ id: 'a' }),
      result({ id: 'b', matched: false }),
      result({ id: 'c', ...absent, matched: false }),
      result({ id: 'd', ...absent, matched: true }),
      result({ id: 'e', ...absent, matched: false }),
    ]);

    expect(summary.metrics).toMatchObject({ 'ndcg@10': 1, match: 0.5, 'no-match': 0.667 });
    expect(summary.byTag.absent).toBeUndefined();
    expect(formatSummaries([summary])[0]).toContain('no-match');
  });
});

describe('baseline', () => {
  const summaries = [summarizeMode(RecipeSearchMode.Hybrid, [result()])];
  const current = { model: 'm', documentVersion: 1, casesHash: casesHash('cases') };
  const baseline = toRetrievalBaseline('m', 1, current.casesHash, summaries, new Date(0));

  it('keeps the means of every mode', () => {
    expect(baseline).toEqual({
      model: 'm',
      documentVersion: 1,
      casesHash: current.casesHash,
      createdAt: '1970-01-01T00:00:00.000Z',
      modes: { hybrid: summaries[0].metrics },
    });
  });

  it('passes within the tolerance and flags a larger drop', () => {
    expect(compareWithRetrievalBaseline(baseline, current, summaries)).toEqual({
      stale: null,
      regressions: [],
    });

    const worse = [
      summarizeMode(RecipeSearchMode.Hybrid, [
        result({ metrics: scoreRanking(['z', 'a'], { a: 2 }) }),
      ]),
    ];
    const { regressions } = compareWithRetrievalBaseline(baseline, current, worse);
    expect(regressions).toContainEqual({
      mode: 'hybrid',
      metric: 'mrr@10',
      baseline: 1,
      actual: 0.5,
    });
  });

  it('does not compare a baseline of another model, document version or cases', () => {
    expect(
      compareWithRetrievalBaseline(baseline, { ...current, model: 'n' }, summaries).stale,
    ).toBe('baseline of m');
    expect(
      compareWithRetrievalBaseline(baseline, { ...current, documentVersion: 2 }, summaries).stale,
    ).toBe('baseline of document version 1');
    expect(
      compareWithRetrievalBaseline(baseline, { ...current, casesHash: 'x' }, summaries).stale,
    ).toBe('baseline of other cases');
  });

  it('names the file after the model', () => {
    expect(retrievalBaselineFile('ollama/qwen3-embedding:0.6b-q8_0@1024')).toBe(
      'ollama_qwen3-embedding_0.6b-q8_0@1024.json',
    );
  });
});
