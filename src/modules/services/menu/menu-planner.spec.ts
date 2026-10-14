import {
  MealType,
  MenuGeneratedBy,
  MenuIssueCode,
  MenuIssueSeverity,
} from '../../../common/constants';
import {
  MenuMealNotFoundException,
  MenuPlanningFailedException,
  NoRecipeCandidatesException,
  NutritionGoalNotFoundException,
} from '../../../common/exceptions';
import { MenuDayDraft, MenuIssue } from '../../../common/types';
import { createMock } from '../../../test/create-mock';
import {
  buildFoodItem,
  buildIngredient,
  buildNutritionGoal,
  buildRecipe,
  PROFILE_ID,
  RECIPE_ID,
} from '../../../test/fixtures';
import { MenuVersionData } from '../../data-access/menu/menu.repository';
import { Assistant } from '../assistant/assistant';
import { NutritionService } from '../nutrition/nutrition.service';
import { RecipeService } from '../recipe/recipe.service';
import { MenuComposer, MenuContext, toGoalSnapshot } from './menu-composer';
import { MenuPlanner } from './menu-planner';

describe('MenuPlanner', () => {
  let assistant: jest.Mocked<Assistant>;
  let recipeService: jest.Mocked<RecipeService>;
  let composer: jest.Mocked<MenuComposer>;
  let planner: MenuPlanner;
  const context: MenuContext = {
    profileId: PROFILE_ID,
    goal: toGoalSnapshot(buildNutritionGoal()),
    rules: { diets: [], allergies: ['peanut'], excludedIngredients: [], dislikedFoods: [] },
  };
  const version = { generatedBy: MenuGeneratedBy.Stub } as unknown as MenuVersionData;
  const lunch = buildRecipe();
  const dinner = buildRecipe({ id: 'dinner', name: 'Fish', mealType: MealType.Dinner });
  const peanutDinner = buildRecipe({
    id: 'peanut',
    name: 'Satay',
    mealType: MealType.Dinner,
    ingredients: [buildIngredient({ foodItem: buildFoodItem({ name: 'Peanut butter' }) })],
  });
  const request = {
    days: 2,
    mealTypes: [MealType.Lunch, MealType.Dinner],
    startDate: new Date('2026-10-20T00:00:00Z'),
    instructions: 'quick',
  };
  const day = (dayIndex: number, servings = 1): MenuDayDraft => ({
    dayIndex,
    date: null,
    meals: [
      { mealType: MealType.Lunch, recipeId: RECIPE_ID, servings },
      { mealType: MealType.Dinner, recipeId: 'dinner', servings: 1 },
    ],
  });
  const error = (overrides: Partial<MenuIssue> = {}): MenuIssue => ({
    severity: MenuIssueSeverity.Error,
    code: MenuIssueCode.Allergen,
    message: 'contains peanut',
    dayIndex: 0,
    position: 1,
    recipeId: 'dinner',
    ...overrides,
  });

  beforeEach(() => {
    assistant = createMock<Assistant>({ generatedBy: MenuGeneratedBy.Stub });
    recipeService = createMock<RecipeService>();
    recipeService.getCandidates.mockResolvedValue([lunch, dinner, peanutDinner]);
    composer = createMock<MenuComposer>();
    composer.build.mockResolvedValue({ version, issues: [] });
    planner = new MenuPlanner(assistant, recipeService, new NutritionService(), composer);
  });

  describe('plan', () => {
    beforeEach(() => {
      assistant.planMenu.mockResolvedValue({ title: 'Plan', notes: 'n', days: [day(0), day(1)] });
    });

    it('offers the rule-abiding candidates and builds the proposal', async () => {
      await expect(planner.plan(request, context)).resolves.toEqual({ title: 'Plan', version });

      expect(recipeService.getCandidates).toHaveBeenCalledWith(
        { mealTypes: [MealType.Lunch, MealType.Dinner], dietTypes: [] },
        400,
      );
      const call = assistant.planMenu.mock.calls[0][0];
      expect(call.candidates.map((c) => c.id)).toEqual([RECIPE_ID, 'dinner']);
      expect(call.candidates[0]).toEqual({
        id: RECIPE_ID,
        name: 'Rice with vegetables',
        mealType: MealType.Lunch,
        dietType: lunch.dietType,
        perServing: { kcal: 130, proteinG: 2.7, fatG: 0.3, carbsG: 28.2 },
        complete: true,
      });
      expect(call.days).toEqual([
        { dayIndex: 0, date: new Date('2026-10-20T00:00:00Z') },
        { dayIndex: 1, date: new Date('2026-10-21T00:00:00Z') },
      ]);
      expect(call).toMatchObject({ feedback: [], instructions: 'quick', goal: context.goal });
      expect(composer.build).toHaveBeenCalledWith([day(0), day(1)], context, {
        generatedBy: MenuGeneratedBy.Stub,
        notes: 'n',
      });
    });

    it('leaves undated menus undated', async () => {
      await planner.plan({ ...request, startDate: null }, context);

      expect(assistant.planMenu.mock.calls[0][0].days[1]).toEqual({ dayIndex: 1, date: null });
    });

    it('needs a goal', async () => {
      await expect(planner.plan(request, { ...context, goal: null })).rejects.toBeInstanceOf(
        NutritionGoalNotFoundException,
      );
    });

    it('fails when a meal type has no usable recipe', async () => {
      recipeService.getCandidates.mockResolvedValue([lunch, peanutDinner]);

      await expect(planner.plan(request, context)).rejects.toThrow(
        new NoRecipeCandidatesException(MealType.Dinner),
      );
    });

    it('sends the errors back and accepts the corrected proposal', async () => {
      composer.build.mockResolvedValueOnce({ version, issues: [error()] }).mockResolvedValueOnce({
        version,
        issues: [error({ severity: MenuIssueSeverity.Warning, code: MenuIssueCode.DislikedFood })],
      });

      await expect(planner.plan(request, context)).resolves.toEqual({ title: 'Plan', version });
      expect(assistant.planMenu).toHaveBeenCalledTimes(2);
      expect(assistant.planMenu.mock.calls[1][0].feedback).toEqual([error()]);
    });

    it.each([
      ['missing days', [day(0)], 'Expected days 0, 1, got 0'],
      [
        'wrong meals',
        [day(0), { ...day(1), meals: day(1).meals.slice(0, 1) }],
        'Day 2: expected lunch, dinner, got lunch',
      ],
      ['bad servings', [day(0), day(1, 50)], 'Day 2: 50 servings is outside 0.25-10'],
    ])('rejects a proposal with %s without building it', async (_name, days, message) => {
      assistant.planMenu.mockResolvedValue({ title: 'Plan', notes: null, days });

      await expect(planner.plan(request, context)).rejects.toThrow(
        new MenuPlanningFailedException(3, [message]),
      );
      expect(composer.build).not.toHaveBeenCalled();
      expect(assistant.planMenu).toHaveBeenCalledTimes(3);
    });

    it('gives up after three rejected proposals', async () => {
      composer.build.mockResolvedValue({ version, issues: [error()] });

      await expect(planner.plan(request, context)).rejects.toThrow(
        new MenuPlanningFailedException(3, ['contains peanut']),
      );
    });
  });

  describe('replaceMeal', () => {
    const draft = [day(0), day(1)];
    const target = { dayIndex: 1, position: 1, instructions: null };

    beforeEach(() => {
      assistant.replaceMeal.mockResolvedValue({ recipeId: 'fish-2', servings: 1.5, notes: 'n' });
    });

    it('swaps the meal in the draft and builds the next version', async () => {
      await expect(planner.replaceMeal(draft, target, context)).resolves.toBe(version);

      expect(recipeService.getCandidates).toHaveBeenCalledWith(
        { mealTypes: [MealType.Dinner], dietTypes: [] },
        200,
      );
      expect(assistant.replaceMeal).toHaveBeenCalledWith(
        expect.objectContaining({ day: draft[1], position: 1, goal: context.goal }),
      );
      expect(composer.build).toHaveBeenCalledWith(
        [
          day(0),
          {
            ...day(1),
            meals: [
              day(1).meals[0],
              { mealType: MealType.Dinner, recipeId: 'fish-2', servings: 1.5 },
            ],
          },
        ],
        context,
        { generatedBy: MenuGeneratedBy.Stub, notes: 'n' },
      );
    });

    it('404s for a meal that is not there', async () => {
      await expect(
        planner.replaceMeal(draft, { ...target, position: 5 }, context),
      ).rejects.toBeInstanceOf(MenuMealNotFoundException);
      await expect(
        planner.replaceMeal(draft, { ...target, dayIndex: 7 }, context),
      ).rejects.toBeInstanceOf(MenuMealNotFoundException);
    });

    it('ignores errors of the other meals, retries on errors of the new one', async () => {
      composer.build
        .mockResolvedValueOnce({ version, issues: [error({ dayIndex: 1, position: 1 })] })
        .mockResolvedValueOnce({ version, issues: [error({ dayIndex: 0, position: 0 })] });

      await expect(planner.replaceMeal(draft, target, context)).resolves.toBe(version);
      expect(assistant.replaceMeal).toHaveBeenCalledTimes(2);
    });

    it('retries when a recipe disappeared', async () => {
      composer.build
        .mockResolvedValueOnce({
          version: null,
          issues: [error({ code: MenuIssueCode.RecipeNotFound, dayIndex: 1, position: 1 })],
        })
        .mockResolvedValueOnce({ version, issues: [] });

      await expect(planner.replaceMeal(draft, target, context)).resolves.toBe(version);
    });

    it('rejects implausible servings and gives up', async () => {
      assistant.replaceMeal.mockResolvedValue({ recipeId: 'x', servings: 0, notes: null });

      await expect(planner.replaceMeal(draft, target, context)).rejects.toBeInstanceOf(
        MenuPlanningFailedException,
      );
      expect(composer.build).not.toHaveBeenCalled();
    });
  });
});
