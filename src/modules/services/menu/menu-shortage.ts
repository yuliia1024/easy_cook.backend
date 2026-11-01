import {
  MENU_PLAN_MEAL_TYPES,
  MENU_RECIPE_MAX_DAYS,
  MENU_SHORTAGE_MAX_OPTIONS,
  MENU_SHORTAGE_NO_OPTIONS_REPLY,
  MenuConstraintKind,
} from '../../../common/constants';
import { PreferenceRules } from '../../../common/types';
import { MenuPlanMealType } from './menu-plan';
import { AllowableRecipe, isRecipeAllowed } from './menu-rules';

/** A rule of the menu; `fromProfile` when the profile sets it, not only the chat. */
export interface MenuConstraint {
  kind: MenuConstraintKind;
  value: string;
  fromProfile: boolean;
}

export interface MenuShortage {
  days: number;
  /** The recipes every meal needs for `days` days (`menuMinRecipes`). */
  required: number;
  /** The meals with fewer recipes than `required`, with how many they have. */
  shortMeals: Array<{ mealType: MenuPlanMealType; count: number }>;
  /**
   * The rules that rule out a recipe of a short meal, alone or with another one (vegan and low
   * carb together): what the reply names.
   */
  limiting: MenuConstraint[];
  /**
   * The rules to drop that leave enough recipes for every meal: one each, or two together when
   * no single one does. Allergies are never offered.
   */
  options: MenuConstraint[][];
  /** The most days the allowed recipes are enough for, below `days`; null when none. */
  maxDays: number | null;
}

type MealRecipe = { mealType: string };
type MealCounts = Record<MenuPlanMealType, number>;

/**
 * The recipes a meal of a menu of `days` days needs: one serves at most `MENU_RECIPE_MAX_DAYS`
 * days and never two in a row, so two from the second day on. Pure.
 */
export const menuMinRecipes = (days: number): number =>
  Math.min(days, Math.max(2, Math.ceil(days / MENU_RECIPE_MAX_DAYS)));

const countByMeal = (recipes: MealRecipe[]): MealCounts =>
  Object.fromEntries(
    MENU_PLAN_MEAL_TYPES.map((mealType) => [
      mealType,
      recipes.filter((recipe) => recipe.mealType === mealType).length,
    ]),
  ) as MealCounts;

const shortOf = (counts: MealCounts, days: number): MenuPlanMealType[] =>
  MENU_PLAN_MEAL_TYPES.filter((mealType) => counts[mealType] < menuMinRecipes(days));

/** Whether the recipes are enough for every meal of a menu of `days` days. Pure. */
export const hasEnoughRecipes = (recipes: MealRecipe[], days: number): boolean =>
  shortOf(countByMeal(recipes), days).length === 0;

/** The diets, excluded ingredients and allergies of the rules, in that order. */
function constraintsOf(rules: PreferenceRules, profileRules: PreferenceRules): MenuConstraint[] {
  const of = (kind: MenuConstraintKind, values: string[], profile: string[]): MenuConstraint[] =>
    values.map((value) => ({ kind, value, fromProfile: profile.includes(value) }));
  return [
    ...of(MenuConstraintKind.Diet, rules.diets, profileRules.diets),
    ...of(
      MenuConstraintKind.ExcludedIngredient,
      rules.excludedIngredients,
      profileRules.excludedIngredients,
    ),
    ...of(MenuConstraintKind.Allergy, rules.allergies, profileRules.allergies),
  ];
}

const RULE_FIELD: Record<
  MenuConstraintKind,
  keyof Pick<PreferenceRules, 'diets' | 'excludedIngredients' | 'allergies'>
> = {
  [MenuConstraintKind.Diet]: 'diets',
  [MenuConstraintKind.ExcludedIngredient]: 'excludedIngredients',
  [MenuConstraintKind.Allergy]: 'allergies',
};

function without(rules: PreferenceRules, dropped: MenuConstraint[]): PreferenceRules {
  const relaxed = { ...rules };
  for (const { kind, value } of dropped) {
    const field = RULE_FIELD[kind];
    relaxed[field] = relaxed[field].filter((v) => v !== value);
  }
  return relaxed;
}

const NO_RULES: PreferenceRules = {
  diets: [],
  allergies: [],
  excludedIngredients: [],
  dislikedFoods: [],
};

const only = ({ kind, value }: MenuConstraint): PreferenceRules => ({
  ...NO_RULES,
  [RULE_FIELD[kind]]: [value],
});

const pairsOf = <T>(items: T[]): T[][] =>
  items.flatMap((first, i) => items.slice(i + 1).map((second) => [first, second]));

/**
 * Why `recipes` (all of them, whatever the rules) are too few for a menu of `days` days under
 * `rules` (the profile's with those of the chat, `profileRules` only the profile's): the meals
 * short of recipes, the rules that rule some of them out, which of those to drop to get enough
 * and the most days the allowed ones are enough for. Null when they are enough. Pure.
 */
export function findMenuShortage(
  recipes: Array<AllowableRecipe & MealRecipe>,
  rules: PreferenceRules,
  profileRules: PreferenceRules,
  days: number,
): MenuShortage | null {
  const countsUnder = (r: PreferenceRules): MealCounts =>
    countByMeal(recipes.filter((recipe) => isRecipeAllowed(recipe, r)));
  const counts = countsUnder(rules);
  const short = shortOf(counts, days);
  if (short.length === 0) {
    return null;
  }
  const shortRecipes = recipes.filter(({ mealType }) =>
    short.includes(mealType as MenuPlanMealType),
  );
  const limiting = constraintsOf(rules, profileRules).filter((constraint) =>
    shortRecipes.some((recipe) => !isRecipeAllowed(recipe, only(constraint))),
  );
  const relaxable = limiting.filter(({ kind }) => kind !== MenuConstraintKind.Allergy);
  const fits = (dropped: MenuConstraint[]): boolean =>
    shortOf(countsUnder(without(rules, dropped)), days).length === 0;
  const singles = relaxable.map((constraint) => [constraint]).filter(fits);
  const options = singles.length > 0 ? singles : pairsOf(relaxable).filter(fits);
  const fewerDays = Array.from({ length: days - 1 }, (_, i) => days - 1 - i);
  return {
    days,
    required: menuMinRecipes(days),
    shortMeals: short.map((mealType) => ({ mealType, count: counts[mealType] })),
    limiting,
    options: options.slice(0, MENU_SHORTAGE_MAX_OPTIONS),
    maxDays: fewerDays.find((d) => shortOf(counts, d).length === 0) ?? null,
  };
}

const MEAL_PLURAL: Record<MenuPlanMealType, string> = {
  breakfast: 'breakfasts',
  lunch: 'lunches',
  snack: 'snacks',
  dinner: 'dinners',
};

const listOf = (items: string[], conjunction: 'and' | 'or'): string =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} ${conjunction} ${items[items.length - 1]}`;

const dietName = (diet: string): string => `the ${diet.replaceAll('_', ' ')} diet`;

function constraintName({ kind, value }: MenuConstraint): string {
  switch (kind) {
    case MenuConstraintKind.Diet:
      return dietName(value);
    case MenuConstraintKind.ExcludedIngredient:
      return `excluding ${value}`;
    case MenuConstraintKind.Allergy:
      return `the ${value} allergy`;
  }
}

function relaxing({ kind, value, fromProfile }: MenuConstraint): string {
  if (kind === MenuConstraintKind.Diet) {
    return fromProfile ? `remove ${dietName(value)} from your profile` : `drop ${dietName(value)}`;
  }
  return fromProfile ? `allow ${value} in your profile` : `allow ${value}`;
}

const mealCount = ({ mealType, count }: MenuShortage['shortMeals'][number]): string =>
  count === 0
    ? `no ${MEAL_PLURAL[mealType]}`
    : `${count} ${count === 1 ? mealType : MEAL_PLURAL[mealType]}`;

/**
 * The reply to a shortage: which rules leave how few recipes of which meals, then the ways out
 * (drop a rule, plan fewer days), or `MENU_SHORTAGE_NO_OPTIONS_REPLY` when there is none. It
 * never asks the user to add recipes. Pure.
 */
export function menuShortageReply(shortage: MenuShortage): string {
  const { days, required, shortMeals, limiting, options, maxDays } = shortage;
  const found = listOf(shortMeals.map(mealCount), 'and');
  const cause =
    limiting.length > 0
      ? `${listOf(limiting.map(constraintName), 'and')} ${limiting.length === 1 ? 'leaves' : 'leave'} ${found}`
      : `the recipe book has ${found}`;
  const need =
    required === 1
      ? 'at least 1 recipe for every meal'
      : `at least ${required} different recipes for every meal`;
  const ways = [
    ...options.map((dropped) => listOf(dropped.map(relaxing), 'and')),
    ...(maxDays === null
      ? []
      : [`plan ${maxDays} ${maxDays === 1 ? 'day' : 'days'} instead of ${days}`]),
  ];
  const next =
    ways.length > 0
      ? `To get a good menu, you could ${listOf(ways, 'or')}. Which would you like?`
      : MENU_SHORTAGE_NO_OPTIONS_REPLY;
  return `I can't plan a good ${days}-day menu: ${cause}, and it needs ${need}. ${next}`;
}
