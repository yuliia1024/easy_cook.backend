import { ModelProviderName } from '../../src/common/constants';
import { buildEchoSuite } from '../test/helpers';
import { EvalArgs } from './args';
import { Baseline } from './baseline';
import { ALL_SUITES, EvalTrigger, planFromArgs, planFromChanges } from './plan';
import { EvalSuite } from './types';

describe('eval plan', () => {
  const suite = (name: string): EvalSuite => ({ ...buildEchoSuite(), name }) as EvalSuite;
  const suites = [suite('intent'), suite('menu'), suite('chat')];
  const model = 'gpt-4o-mini';
  const baseline = (overrides: Partial<Baseline> = {}): Baseline => ({
    suite: 'intent',
    createdAt: '2026-10-22T10:00:00.000Z',
    prompts: ['echo@v1'],
    models: [model],
    cases: 1,
    repeat: 1,
    passRate: 1,
    fields: {},
    tags: {},
    metrics: {},
    passedCases: [],
    ...overrides,
  });
  const current = (): Baseline => baseline();
  const triggers: EvalTrigger[] = [
    { paths: ['src/providers/'], suites: ALL_SUITES },
    { paths: ['src/intent/'], suites: ['intent'] },
    { paths: ['src/nutrition/'], suites: ['chat', 'menu'], tags: ['numbers'] },
    { paths: ['src/rules.ts'], suites: ['chat'], tags: ['search', 'allergy'] },
  ];
  const plan = (files: string[], baselineOf: (name: string) => Baseline | null = current) =>
    planFromChanges(files, suites, triggers, baselineOf, model);

  describe('planFromArgs', () => {
    const args = (overrides: Partial<EvalArgs>): EvalArgs => ({
      suites: [],
      tags: [],
      changedSince: null,
      saveBaseline: false,
      concurrency: 1,
      repeat: 1,
      provider: ModelProviderName.OpenAi,
      ...overrides,
    });

    it('plans every suite when none is chosen, each with the tags', () => {
      expect(planFromArgs(args({ tags: ['save'] }), suites)).toEqual([
        { suite: 'intent', tags: ['save'], reasons: [] },
        { suite: 'menu', tags: ['save'], reasons: [] },
        { suite: 'chat', tags: ['save'], reasons: [] },
      ]);
    });

    it('plans the chosen suites only', () => {
      expect(planFromArgs(args({ suites: ['chat'] }), suites)).toEqual([
        { suite: 'chat', tags: [], reasons: [] },
      ]);
    });
  });

  describe('planFromChanges', () => {
    it('plans nothing when no trigger matches', () => {
      expect(plan(['src/agent-run/agent-run.service.ts', 'README.md'])).toEqual([]);
    });

    it('ignores specs', () => {
      expect(plan(['src/intent/intent.service.spec.ts', 'evals/suites/menu/menu.spec.ts'])).toEqual(
        [],
      );
    });

    it('runs every suite whole on a trigger of all suites', () => {
      expect(plan(['src/providers/open-ai.ts']).map(({ suite, tags }) => [suite, tags])).toEqual([
        ['intent', []],
        ['menu', []],
        ['chat', []],
      ]);
    });

    it('runs only the tags of tagged triggers, merged and sorted', () => {
      expect(plan(['src/nutrition/nutrition.ts', 'src/rules.ts'])).toEqual([
        { suite: 'menu', tags: ['numbers'], reasons: ['src/nutrition/nutrition.ts'] },
        {
          suite: 'chat',
          tags: ['allergy', 'numbers', 'search'],
          reasons: ['src/nutrition/nutrition.ts', 'src/rules.ts'],
        },
      ]);
    });

    it('runs a suite whole when a trigger without tags matches it too', () => {
      expect(plan(['src/nutrition/a.ts', 'src/providers/b.ts'])[2]).toEqual({
        suite: 'chat',
        tags: [],
        reasons: ['src/providers/b.ts', 'src/nutrition/a.ts'],
      });
    });

    it('runs a suite whole when its folder changes', () => {
      expect(plan(['evals/suites/menu/cases.jsonl'])).toEqual([
        { suite: 'menu', tags: [], reasons: ['evals/suites/menu/cases.jsonl'] },
      ]);
    });

    it('runs a suite whole when its prompt versions or model differ from the baseline', () => {
      const baselines: Record<string, Baseline> = {
        intent: baseline({ prompts: ['echo@v0'] }),
        menu: baseline({ models: ['gpt-4.1'] }),
        chat: baseline(),
      };

      expect(plan([], (name) => baselines[name])).toEqual([
        { suite: 'intent', tags: [], reasons: ['prompts echo@v0 -> echo@v1'] },
        { suite: 'menu', tags: [], reasons: [`model gpt-4.1 -> ${model}`] },
      ]);
    });

    it('does not plan a suite only because it has no baseline', () => {
      expect(plan([], () => null)).toEqual([]);
    });
  });
});
