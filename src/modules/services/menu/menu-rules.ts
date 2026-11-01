import {
  Allergen,
  ALLERGEN_ALIASES,
  DIET_SATISFIED_BY,
  DietTag,
  MENU_DAY_KCAL_TOLERANCE,
  MenuIssueCode,
  MenuIssueSeverity,
} from '../../../common/constants';
import {
  DayComposition,
  MenuIssue,
  NutritionGoalSnapshot,
  PreferenceRules,
  RecipeSnapshot,
  ResolvedDay,
} from '../../../common/types';

export type RecipeIssue = Pick<MenuIssue, 'severity' | 'code' | 'message'>;

/** The recipe tags that satisfy the diet; a diet outside `DIET_SATISFIED_BY` only by itself. */
export function dietTagsSatisfying(diet: string): readonly string[] {
  return DIET_SATISFIED_BY[diet as DietTag] ?? [diet];
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The preference as a whole word (or its plural) of the food name, any case and any alphabet:
 * "peanut" matches "Peanut butter" and "Peanuts, roasted", "egg" does not match "Eggplant".
 */
export function mentions(text: string, value: string): boolean {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(value)}(e?s)?(?![\\p{L}\\p{N}])`, 'iu').test(
    text,
  );
}

/** Whether the food name mentions an allergy or an excluded ingredient of the rules. */
export function isForbiddenFood(
  name: string,
  nameEn: string | null,
  { allergies, excludedIngredients }: PreferenceRules,
): boolean {
  return [...allergies, ...excludedIngredients].some(
    (value) => mentions(name, value) || (nameEn !== null && mentions(nameEn, value)),
  );
}

/** The allergens a profile allergy names: "dairy" -> milk, "tree nuts" -> tree nut, "kiwi" -> none. */
export function allergensOf(allergy: string): Allergen[] {
  return (Object.entries(ALLERGEN_ALIASES) as [Allergen, readonly string[]][])
    .filter(([, aliases]) => aliases.some((alias) => mentions(allergy, alias)))
    .map(([allergen]) => allergen);
}

/** The first allergen of the recipe that the allergy names. */
export function allergenMatching(
  recipeAllergens: readonly string[],
  allergy: string,
): Allergen | undefined {
  return allergensOf(allergy).find((allergen) => recipeAllergens.includes(allergen));
}

/** What `isRecipeAllowed` reads of a recipe. */
export interface AllowableRecipe {
  dietType: string[];
  allergens: string[];
  ingredients: Array<{ foodItem: { name: string; nameEn: string | null } }>;
}

/**
 * Whether the recipe satisfies every diet (a vegan one fits a vegetarian) and has no allergen or
 * excluded ingredient (optional ones too), by food name and by its allergens. Disliked foods
 * only warn, so they never rule a recipe out. Pure.
 */
export function isRecipeAllowed(recipe: AllowableRecipe, rules: PreferenceRules): boolean {
  return (
    rules.diets.every((diet) =>
      dietTagsSatisfying(diet).some((tag) => recipe.dietType.includes(tag)),
    ) &&
    !recipe.ingredients.some(({ foodItem }) =>
      isForbiddenFood(foodItem.name, foodItem.nameEn, rules),
    ) &&
    !rules.allergies.some((allergy) => allergenMatching(recipe.allergens, allergy))
  );
}

/** The first ingredient (optional ones too) whose name mentions the value. */
function ingredientMentioning(recipe: RecipeSnapshot, value: string): string | undefined {
  return recipe.ingredients.find(
    (i) => mentions(i.foodName, value) || (i.foodNameEn !== null && mentions(i.foodNameEn, value)),
  )?.foodName;
}

/** What is wrong with a recipe for this profile, regardless of where it is in the menu. */
export function recipeIssues(recipe: RecipeSnapshot, rules: PreferenceRules): RecipeIssue[] {
  const issues: RecipeIssue[] = [];
  const error = (code: MenuIssueCode, message: string): void => {
    issues.push({ severity: MenuIssueSeverity.Error, code, message });
  };

  for (const diet of rules.diets) {
    if (!dietTagsSatisfying(diet).some((tag) => recipe.dietType.includes(tag))) {
      error(MenuIssueCode.DietViolation, `${recipe.name} is not ${diet}`);
    }
  }
  for (const allergy of rules.allergies) {
    const food =
      ingredientMentioning(recipe, allergy) ?? allergenMatching(recipe.allergens ?? [], allergy);
    if (food) {
      error(MenuIssueCode.Allergen, `${recipe.name} contains ${food} (allergy: ${allergy})`);
    }
  }
  for (const excluded of rules.excludedIngredients) {
    const food = ingredientMentioning(recipe, excluded);
    if (food) {
      error(
        MenuIssueCode.ExcludedIngredient,
        `${recipe.name} contains ${food} (excluded: ${excluded})`,
      );
    }
  }
  for (const disliked of rules.dislikedFoods) {
    const food = ingredientMentioning(recipe, disliked);
    if (food) {
      issues.push({
        severity: MenuIssueSeverity.Warning,
        code: MenuIssueCode.DislikedFood,
        message: `${recipe.name} contains ${food}, which you dislike`,
      });
    }
  }

  return issues;
}

/**
 * Checks a menu against the profile: hard rules per meal (diets, allergies, excluded ingredients)
 * are errors, disliked foods, days away from the calorie goal and unknown nutrient values are
 * warnings. Pure; `days` and `composed` describe the same menu.
 */
export function validateMenu(
  days: ResolvedDay[],
  composed: DayComposition[],
  rules: PreferenceRules,
  goal: NutritionGoalSnapshot | null,
): MenuIssue[] {
  const issues: MenuIssue[] = [];

  days.forEach((day, d) => {
    day.meals.forEach((meal, position) => {
      for (const issue of recipeIssues(meal.recipe, rules)) {
        issues.push({
          ...issue,
          message: `Day ${day.dayIndex + 1}, ${meal.mealType}: ${issue.message}`,
          dayIndex: day.dayIndex,
          position,
          recipeId: meal.recipeId,
        });
      }
    });

    const { totals, complete } = composed[d];
    if (goal) {
      const deviation = (totals.kcal - goal.caloriesKcal) / goal.caloriesKcal;
      if (Math.abs(deviation) > MENU_DAY_KCAL_TOLERANCE) {
        issues.push({
          severity: MenuIssueSeverity.Warning,
          code: MenuIssueCode.CaloriesOffTarget,
          message:
            `Day ${day.dayIndex + 1}: ${Math.round(totals.kcal)} kcal is ` +
            `${Math.round(Math.abs(deviation) * 100)} % ${deviation > 0 ? 'above' : 'below'} ` +
            `the ${goal.caloriesKcal} kcal goal`,
          dayIndex: day.dayIndex,
        });
      }
    }
    if (!complete) {
      issues.push({
        severity: MenuIssueSeverity.Warning,
        code: MenuIssueCode.NutritionIncomplete,
        message: `Day ${day.dayIndex + 1}: some ingredients have unknown values, totals are too low`,
        dayIndex: day.dayIndex,
      });
    }
  });

  return issues;
}

export const errorsOf = (issues: MenuIssue[]): MenuIssue[] =>
  issues.filter((issue) => issue.severity === MenuIssueSeverity.Error);
