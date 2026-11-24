import {
  MENU_PLAN_CANDIDATES_MAX,
  MENU_PLAN_PROMPT,
  MealType,
  MenuIssueCode,
  MenuIssueSeverity,
  menuPlanMaxOutputTokens,
  menuPlanRetryMessage,
} from '../../../common/constants';
import { MenuPlan, MenuPlanSchema } from '../../../common/contracts';
import {
  AssistantInvalidOutputException,
  AssistantUnavailableException,
} from '../../../common/exceptions';
import { MenuComposition, ProfileContext } from '../../../common/types';
import { PROFILE_ID } from '../../../test/fixtures';
import { toModelProfile } from '../profile-context/model-profile';
import {
  bestAttempt,
  candidatesPerMeal,
  labelCandidates,
  MenuPlanAttempt,
  MenuPlanCandidate,
  MenuPlanCandidates,
  menuPlanErrors,
  menuPlanModelCall,
  menuPlanRepeats,
  planDays,
  planProblems,
  planWithRetries,
  selectCandidates,
  varietyProblems,
} from './menu-plan';

const candidate = (id: string, kcal: number): MenuPlanCandidate => ({
  id,
  name: id,
  perServing: { kcal, proteinG: 0, fatG: 0, carbsG: 0 },
  complete: true,
});

describe('candidatesPerMeal', () => {
  it.each([
    [1, 6],
    [3, 8],
    [7, MENU_PLAN_CANDIDATES_MAX],
  ])('offers %i day(s) %i candidates', (days, count) => {
    expect(candidatesPerMeal(days)).toBe(count);
  });
});

describe('selectCandidates', () => {
  // A lunch is 35 % of the day: 700 kcal of 2000; l600 and l800 tie, in their order.
  const lunches = [100, 200, 400, 600, 700, 800, 900, 1000].map((kcal) =>
    candidate(`l${kcal}`, kcal),
  );
  const ids = (selected: MenuPlanCandidate[]): string[] => selected.map(({ id }) => id);

  it('takes the recipes closest to the calorie share of the meal', () => {
    expect(ids(selectCandidates(lunches, MealType.Lunch, 2000, 2, 0))).toEqual(['l700', 'l600']);
  });

  it('rotates within a pool of twice the count, wrapping around', () => {
    // Pool: l700, l600, l800, l900.
    expect(ids(selectCandidates(lunches, MealType.Lunch, 2000, 2, 1))).toEqual(['l600', 'l800']);
    expect(ids(selectCandidates(lunches, MealType.Lunch, 2000, 2, 3))).toEqual(['l900', 'l700']);
    expect(ids(selectCandidates(lunches, MealType.Lunch, 2000, 2, 5))).toEqual(['l600', 'l800']);
  });

  it('keeps the order of the recipes without a calorie target', () => {
    expect(ids(selectCandidates(lunches, MealType.Lunch, null, 2, 0))).toEqual(['l100', 'l200']);
  });

  it('offers every recipe when there are no more than the count', () => {
    expect(selectCandidates(lunches.slice(0, 3), MealType.Lunch, 2000, 5, 2)).toHaveLength(3);
  });

  it('puts the wished recipes first, up to half the count, and fills the rest from the pool', () => {
    // Without l100 and l700 the pool is l600, l800, l900, l400 (twice the two places left).
    expect(
      ids(selectCandidates(lunches, MealType.Lunch, 2000, 4, 0, ['l100', 'unknown', 'l700'])),
    ).toEqual(['l100', 'l700', 'l600', 'l800']);
    expect(
      ids(selectCandidates(lunches, MealType.Lunch, 2000, 2, 0, ['l100', 'l200', 'l400'])),
    ).toEqual(['l100', 'l700']);
  });

  it('leaves out the disliked recipes while the others fill the candidates', () => {
    const disliked = new Set(['l700', 'l600']);

    expect(ids(selectCandidates(lunches, MealType.Lunch, 2000, 2, 0, [], disliked))).toEqual([
      'l800',
      'l900',
    ]);
    expect(ids(selectCandidates(lunches, MealType.Lunch, 2000, 2, 3, [], disliked))).toEqual([
      'l1000',
      'l800',
    ]);
  });

  it('takes every other recipe and the disliked ones closest to the calories for want of others', () => {
    const disliked = new Set(['l100', 'l200', 'l400', 'l600', 'l700', 'l900']);

    expect(ids(selectCandidates(lunches, MealType.Lunch, 2000, 4, 5, [], disliked))).toEqual([
      'l800',
      'l1000',
      'l700',
      'l600',
    ]);
  });

  it('keeps a wished recipe with a disliked food: the user asked for it', () => {
    expect(
      ids(selectCandidates(lunches, MealType.Lunch, 2000, 2, 0, ['l100'], new Set(['l100']))),
    ).toEqual(['l100', 'l700']);
  });

  it('ignores wished ids of other meals or none at all', () => {
    expect(ids(selectCandidates(lunches, MealType.Lunch, 2000, 2, 0, ['b1']))).toEqual([
      'l700',
      'l600',
    ]);
  });
});

describe('labelCandidates', () => {
  it('gives every candidate a short id by meal and position and maps it to the recipe', () => {
    const { candidates, recipeIds } = labelCandidates({
      breakfast: [candidate('rec-b1', 400), candidate('rec-b2', 300)],
      lunch: [candidate('rec-l', 700)],
      dinner: [candidate('rec-d', 600)],
      snack: [candidate('rec-s', 150)],
    });

    expect(candidates).toEqual({
      breakfast: [
        { ...candidate('rec-b1', 400), id: 'b1' },
        { ...candidate('rec-b2', 300), id: 'b2' },
      ],
      lunch: [{ ...candidate('rec-l', 700), id: 'l1' }],
      dinner: [{ ...candidate('rec-d', 600), id: 'd1' }],
      snack: [{ ...candidate('rec-s', 150), id: 's1' }],
    });
    expect([...recipeIds]).toEqual([
      ['b1', 'rec-b1'],
      ['b2', 'rec-b2'],
      ['l1', 'rec-l'],
      ['s1', 'rec-s'],
      ['d1', 'rec-d'],
    ]);
  });
});

describe('menuPlanModelCall', () => {
  it('sends the request, the days, the profile and the candidates, with output for every day', () => {
    const profile: ProfileContext = {
      profileId: PROFILE_ID,
      goal: null,
      nutritionGoal: null,
      rules: { diets: [], allergies: [], excludedIngredients: [], dislikedFoods: [] },
    };
    const candidates: MenuPlanCandidates = {
      breakfast: [candidate('b', 400)],
      lunch: [candidate('l', 700)],
      dinner: [candidate('d', 600)],
      snack: [candidate('s', 150)],
    };
    const abort = new AbortController();

    expect(menuPlanModelCall('Two days', 2, profile, candidates, abort.signal)).toEqual({
      input: [
        {
          role: 'user',
          content: JSON.stringify({
            request: 'Two days',
            days: 2,
            profile: toModelProfile(profile),
            recipes: candidates,
          }),
        },
      ],
      schema: MenuPlanSchema,
      options: {
        prompt: MENU_PLAN_PROMPT,
        maxOutputTokens: menuPlanMaxOutputTokens(2),
        abortSignal: abort.signal,
      },
    });
  });
});

describe('planProblems', () => {
  const candidates: MenuPlanCandidates = {
    breakfast: [candidate('b', 400)],
    lunch: [candidate('l', 700)],
    dinner: [candidate('d', 600)],
    snack: [candidate('s', 150)],
  };
  const meals = { breakfast: 'b', lunch: 'l', dinner: 'd', snack: 's' };
  const plan = (...days: MenuPlan['days']): MenuPlan => ({ message: '', days });

  it('finds none in a plan of the requested days from the candidates, in any order', () => {
    expect(
      planProblems(plan({ dayIndex: 1, meals }, { dayIndex: 0, meals }), candidates, 2),
    ).toEqual([]);
  });

  it.each([
    ['too few days', plan({ dayIndex: 0, meals }), '[0]'],
    ['a repeated dayIndex', plan({ dayIndex: 0, meals }, { dayIndex: 0, meals }), '[0,0]'],
    [
      'a dayIndex that does not start at 0',
      plan({ dayIndex: 1, meals }, { dayIndex: 2, meals }),
      '[1,2]',
    ],
  ])('names %s', (_case, wrong, returned) => {
    expect(planProblems(wrong, candidates, 2)).toEqual([
      `Return exactly 2 days with dayIndex 0 to 1, each once; you returned dayIndex ${returned}.`,
    ]);
  });

  it('names every meal that is not a candidate of that meal', () => {
    expect(
      planProblems(
        plan({ dayIndex: 0, meals: { breakfast: 'x', lunch: 'l', dinner: 'b', snack: 's' } }),
        candidates,
        1,
      ),
    ).toEqual([
      'dayIndex 0, breakfast: "x" is not an id from the breakfast recipes.',
      'dayIndex 0, dinner: "b" is not an id from the dinner recipes.',
    ]);
  });
});

describe('planDays', () => {
  it('orders the meals of the days by dayIndex', () => {
    const first = { breakfast: 'b1', lunch: 'l1', dinner: 'd1', snack: 's1' };
    const second = { breakfast: 'b2', lunch: 'l2', dinner: 'd2', snack: 's2' };

    expect(
      planDays({
        message: '',
        days: [
          { dayIndex: 1, meals: second },
          { dayIndex: 0, meals: first },
        ],
      }),
    ).toEqual([first, second]);
  });
});

describe('menuPlanErrors', () => {
  const candidates: MenuPlanCandidates = {
    breakfast: [candidate('b', 400)],
    lunch: [candidate('l', 700)],
    dinner: [candidate('d', 600)],
    snack: [candidate('s', 150)],
  };
  const meals = { breakfast: 'b', lunch: 'l', dinner: 'd', snack: 's' };
  const plan: MenuPlan = { message: '', days: [{ dayIndex: 0, meals }] };
  const menu = (issues: MenuComposition['issues']): MenuComposition => ({
    days: [],
    dailyAverage: { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 },
    issues,
  });

  it('names the problems of the plan without composing it', () => {
    const compose = jest.fn();

    expect(menuPlanErrors(plan, candidates, 2, compose)).toEqual([
      'Return exactly 2 days with dayIndex 0 to 1, each once; you returned dayIndex [0].',
    ]);
    expect(compose).not.toHaveBeenCalled();
  });

  it('names the errors of the composed menu, not its warnings', () => {
    const compose = jest.fn().mockReturnValue(
      menu([
        {
          severity: MenuIssueSeverity.Error,
          code: MenuIssueCode.DietViolation,
          message: 'Day 1, lunch: l is not vegan',
        },
        {
          severity: MenuIssueSeverity.Warning,
          code: MenuIssueCode.DislikedFood,
          message: 'Day 1, dinner: d contains fish, which you dislike',
        },
      ]),
    );

    expect(menuPlanErrors(plan, candidates, 1, compose)).toEqual(['Day 1, lunch: l is not vegan.']);
    expect(compose).toHaveBeenCalledWith([meals]);
  });
});

describe('varietyProblems', () => {
  const ids = (prefix: string, count: number): MenuPlanCandidate[] =>
    Array.from({ length: count }, (_, i) => candidate(`${prefix}${i + 1}`, 400));
  /** As many candidates of every meal as days, but for `lunches`. */
  const candidatesOf = (lunches: number, others = 4): MenuPlanCandidates => ({
    breakfast: ids('b', others),
    lunch: ids('l', lunches),
    dinner: ids('d', others),
    snack: ids('s', others),
  });
  /** A day for every lunch, the other meals all different. */
  const planOf = (...lunches: string[]): MenuPlan => ({
    message: '',
    days: lunches.map((lunch, i) => ({
      dayIndex: i,
      meals: { breakfast: `b${i + 1}`, lunch, dinner: `d${i + 1}`, snack: `s${i + 1}` },
    })),
  });

  it('finds none when every day has another recipe', () => {
    expect(varietyProblems(planOf('l1', 'l2', 'l3'), candidatesOf(4))).toEqual([]);
  });

  it('names a recipe on two days in a row and the candidates not used yet', () => {
    expect(varietyProblems(planOf('l1', 'l1', 'l2'), candidatesOf(4))).toEqual([
      'dayIndex 1, lunch: "l1" is already on dayIndex 0, the day before; not used yet: l3, l4.',
    ]);
  });

  it('names a recipe on two days in a row when every candidate is used', () => {
    expect(varietyProblems(planOf('l1', 'l2', 'l2'), candidatesOf(2))).toEqual([
      'dayIndex 2, lunch: "l2" is already on dayIndex 1, the day before; use another id from the lunch recipes.',
    ]);
  });

  it('names a repeat while the meal has candidates not used yet', () => {
    expect(varietyProblems(planOf('l1', 'l2', 'l1', 'l2'), candidatesOf(3))).toEqual([
      'dayIndex 2, lunch: "l1" is already on dayIndex 0; not used yet: l3.',
      'dayIndex 3, lunch: "l2" is already on dayIndex 1; not used yet: l3.',
    ]);
  });

  it('allows a repeat, not in a row, once every candidate is used', () => {
    expect(varietyProblems(planOf('l1', 'l2', 'l1', 'l2'), candidatesOf(2))).toEqual([]);
  });

  it('allows the only candidate of a meal every day: no plan could do better', () => {
    expect(varietyProblems(planOf('l1', 'l1', 'l1'), candidatesOf(1))).toEqual([]);
  });

  it('reads the days by dayIndex, whatever their order', () => {
    const { days } = planOf('l1', 'l2', 'l1');

    expect(
      varietyProblems({ message: '', days: [days[0], days[2], days[1]] }, candidatesOf(2)),
    ).toEqual([]);
  });

  it('names the repeats of every meal', () => {
    const plan = planOf('l1', 'l1');
    plan.days[1].meals.dinner = 'd1';

    expect(varietyProblems(plan, candidatesOf(2, 2))).toEqual([
      expect.stringContaining('dayIndex 1, lunch: "l1"'),
      expect.stringContaining('dayIndex 1, dinner: "d1"'),
    ]);
  });

  describe('menuPlanRepeats', () => {
    it('are the variety problems of a plan of the right days and candidates', () => {
      const plan = planOf('l1', 'l1');

      expect(menuPlanRepeats(plan, candidatesOf(2), 2)).toEqual(
        varietyProblems(plan, candidatesOf(2)),
      );
      expect(menuPlanRepeats(plan, candidatesOf(2), 2)).toHaveLength(1);
    });

    it('are none of a plan with other days or unknown ids: it goes back for those', () => {
      expect(menuPlanRepeats(planOf('l1', 'l1'), candidatesOf(2), 3)).toEqual([]);
      expect(menuPlanRepeats(planOf('x', 'x'), candidatesOf(2), 2)).toEqual([]);
    });
  });
});

describe('planWithRetries', () => {
  const input = [{ role: 'user' as const, content: 'plan' }];
  const plan = (message: string): MenuPlan => ({ message, days: [] });

  it('stops at the first plan without problems', async () => {
    const generate = jest.fn().mockResolvedValue(plan('ok'));

    await expect(planWithRetries(input, generate, () => [])).resolves.toEqual([
      { plan: plan('ok'), problems: [], softProblems: [] },
    ]);
    expect(generate).toHaveBeenCalledWith(input);
  });

  it('sends a plan with problems back with them and keeps every attempt', async () => {
    const generate = jest
      .fn()
      .mockResolvedValueOnce(plan('wrong'))
      .mockResolvedValueOnce(plan('ok'));
    const problemsOf = (p: MenuPlan): string[] => (p.message === 'wrong' ? ['Bad id.'] : []);

    const attempts = await planWithRetries(input, generate, problemsOf);

    expect(attempts).toEqual([
      { plan: plan('wrong'), problems: ['Bad id.'], softProblems: [] },
      { plan: plan('ok'), problems: [], softProblems: [] },
    ]);
    expect(generate).toHaveBeenLastCalledWith([
      ...input,
      { role: 'assistant', content: JSON.stringify(plan('wrong')) },
      { role: 'user', content: menuPlanRetryMessage(['Bad id.']) },
    ]);
  });

  it('sends the problems in the retry message it is given', async () => {
    const generate = jest
      .fn()
      .mockResolvedValueOnce(plan('wrong'))
      .mockResolvedValueOnce(plan('ok'));
    const retryMessage = (problems: string[]): string => `Fix: ${problems.join(' ')}`;

    await planWithRetries(
      input,
      generate,
      (p) => (p.message === 'wrong' ? ['Bad id.'] : []),
      3,
      retryMessage,
    );

    expect(generate).toHaveBeenLastCalledWith([
      ...input,
      { role: 'assistant', content: JSON.stringify(plan('wrong')) },
      { role: 'user', content: 'Fix: Bad id.' },
    ]);
  });

  it('gives up after the last attempt, returning the plans with their problems', async () => {
    const generate = jest.fn().mockResolvedValue(plan('wrong'));

    const attempts = await planWithRetries(input, generate, () => ['Bad id.'], 2);

    expect(attempts).toHaveLength(2);
    expect(attempts[1].problems).toEqual(['Bad id.']);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  describe('soft problems', () => {
    const hardOf = ({ message }: MenuPlan): string[] =>
      message.includes('wrong') ? ['Bad id.'] : [];
    const softOf = ({ message }: MenuPlan): string[] =>
      message.includes('repeat') ? ['Repeat.'] : [];
    const run = (generate: jest.Mock): Promise<MenuPlanAttempt[]> =>
      planWithRetries(input, generate, hardOf, 3, undefined, softOf);

    it('sends a plan with only soft problems back with them', async () => {
      const generate = jest
        .fn()
        .mockResolvedValueOnce(plan('repeat'))
        .mockResolvedValueOnce(plan('ok'));

      await expect(run(generate)).resolves.toEqual([
        { plan: plan('repeat'), problems: [], softProblems: ['Repeat.'] },
        { plan: plan('ok'), problems: [], softProblems: [] },
      ]);
      expect(generate).toHaveBeenLastCalledWith([
        ...input,
        { role: 'assistant', content: JSON.stringify(plan('repeat')) },
        { role: 'user', content: menuPlanRetryMessage(['Repeat.']) },
      ]);
    });

    it('sends the problems and the soft problems of a plan in one message', async () => {
      const generate = jest
        .fn()
        .mockResolvedValueOnce(plan('wrong repeat'))
        .mockResolvedValueOnce(plan('ok'));

      await run(generate);

      expect(generate.mock.calls[1][0].at(-1).content).toBe(
        menuPlanRetryMessage(['Bad id.', 'Repeat.']),
      );
    });

    it('stops after the last attempt with the soft problems left', async () => {
      const generate = jest.fn().mockResolvedValue(plan('repeat'));

      const attempts = await run(generate);

      expect(generate).toHaveBeenCalledTimes(3);
      expect(bestAttempt(attempts)).toBe(attempts[2]);
      expect(bestAttempt(attempts).problems).toEqual([]);
    });

    it.each([
      ['invalid output', new AssistantInvalidOutputException()],
      ['no provider', new AssistantUnavailableException()],
    ])('keeps an acceptable plan when the retry fails with %s', async (_case, error) => {
      const generate = jest.fn().mockResolvedValueOnce(plan('repeat')).mockRejectedValueOnce(error);

      await expect(run(generate)).resolves.toEqual([
        { plan: plan('repeat'), problems: [], softProblems: ['Repeat.'] },
      ]);
      expect(generate).toHaveBeenCalledTimes(2);
    });

    it('throws the failure of a retry when no attempt is acceptable', async () => {
      const error = new AssistantUnavailableException();
      const generate = jest.fn().mockResolvedValueOnce(plan('wrong')).mockRejectedValueOnce(error);

      await expect(run(generate)).rejects.toBe(error);
    });

    it('throws any other failure (an aborted call) though an attempt is acceptable', async () => {
      const error = new DOMException('Aborted', 'AbortError');
      const generate = jest.fn().mockResolvedValueOnce(plan('repeat')).mockRejectedValueOnce(error);

      await expect(run(generate)).rejects.toBe(error);
    });
  });
});

describe('bestAttempt', () => {
  const attempt = (problems: number, softProblems: number): MenuPlanAttempt => ({
    plan: { message: '', days: [] },
    problems: Array.from({ length: problems }, () => 'Bad id.'),
    softProblems: Array.from({ length: softProblems }, () => 'Repeat.'),
  });

  it.each([
    ['the only attempt', [attempt(0, 0)], 0],
    ['the last of equally repeating ones', [attempt(0, 1), attempt(0, 1)], 1],
    ['the one with the fewest soft problems', [attempt(0, 1), attempt(0, 3)], 0],
    ['one with soft problems over one with problems', [attempt(0, 3), attempt(1, 0)], 0],
    ['the last one when all have problems', [attempt(1, 0), attempt(2, 0)], 1],
  ])('is %s', (_case, attempts, index) => {
    expect(bestAttempt(attempts)).toBe(attempts[index]);
  });
});
