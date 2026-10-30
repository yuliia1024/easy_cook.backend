import { Prisma, PrismaClient } from '../../src/generated/prisma/client';
import { RecipeSource, SortOrder } from '../../src/common/constants';
import { NutritionService } from '../../src/modules/services/nutrition/nutrition.service';
import { compareNutrition, ControlRecipe } from './control-recipes';
import { checkRecipeRules } from './recipe-rules';

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DataSummary {
  foodsBySource: Record<string, number>;
  recipes: number;
  recipeIngredients: number;
}

export interface VerifyReport {
  ok: boolean;
  checks: CheckResult[];
  summary: DataSummary;
}

/** A foreign key of prisma/schema: `child.column` -> `parent.id`. */
export interface ForeignKey {
  child: string;
  column: string;
  parent: string;
}

/** Every foreign key of the schema. Keep in sync with prisma/schema. */
export const FOREIGN_KEYS: readonly ForeignKey[] = [
  { child: 'recipe_ingredients', column: 'recipe_id', parent: 'recipes' },
  { child: 'recipe_ingredients', column: 'food_item_id', parent: 'food_items' },
  { child: 'nutrition_goals', column: 'profile_id', parent: 'user_profiles' },
  { child: 'dietary_preferences', column: 'profile_id', parent: 'user_profiles' },
  { child: 'menus', column: 'profile_id', parent: 'user_profiles' },
  { child: 'menu_versions', column: 'menu_id', parent: 'menus' },
  { child: 'menu_days', column: 'menu_version_id', parent: 'menu_versions' },
  { child: 'menu_meals', column: 'menu_day_id', parent: 'menu_days' },
  { child: 'menu_meals', column: 'recipe_id', parent: 'recipes' },
  { child: 'menus', column: 'confirmed_version_id', parent: 'menu_versions' },
  { child: 'conversations', column: 'profile_id', parent: 'user_profiles' },
  { child: 'conversations', column: 'menu_id', parent: 'menus' },
  { child: 'messages', column: 'conversation_id', parent: 'conversations' },
  { child: 'messages', column: 'menu_version_id', parent: 'menu_versions' },
];

/** Tables with a unique (`source`, `source_id`). */
export const SOURCED_TABLES = ['food_items', 'recipes'] as const;

const IDENTIFIER = /^[a-z_]+$/;

/** Identifiers come from the constants above, never from input; checked anyway. */
function identifier(name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new Error(`Unexpected SQL identifier "${name}"`);
  }
  return `"${name}"`;
}

async function count(prisma: PrismaClient, sql: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: number }>>(Prisma.raw(sql));
  return Number(rows[0]?.count ?? 0);
}

const result = (name: string, problems: number, what: string): CheckResult => ({
  name,
  ok: problems === 0,
  detail: problems === 0 ? 'ok' : `${problems} ${what}`,
});

/** Rows whose foreign key points to no parent row, one LEFT JOIN per key. */
export async function checkForeignKeys(prisma: PrismaClient): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const { child, column, parent } of FOREIGN_KEYS) {
    const orphans = await count(
      prisma,
      `SELECT count(*)::int AS count FROM ${identifier(child)} c ` +
        `LEFT JOIN ${identifier(parent)} p ON p.id = c.${identifier(column)} ` +
        `WHERE c.${identifier(column)} IS NOT NULL AND p.id IS NULL`,
    );
    results.push(result(`fk ${child}.${column} -> ${parent}`, orphans, 'orphan rows'));
  }
  return results;
}

/** (`source`, `source_id`) pairs used more than once. */
export async function checkDuplicateSources(prisma: PrismaClient): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const table of SOURCED_TABLES) {
    const duplicates = await count(
      prisma,
      `SELECT count(*)::int AS count FROM (SELECT source, source_id FROM ${identifier(table)} ` +
        `WHERE source_id IS NOT NULL GROUP BY source, source_id HAVING count(*) > 1) d`,
    );
    results.push(result(`unique ${table} (source, source_id)`, duplicates, 'duplicated keys'));
  }
  return results;
}

export async function checkRecipesHaveIngredients(prisma: PrismaClient): Promise<CheckResult> {
  const empty = await count(
    prisma,
    'SELECT count(*)::int AS count FROM "recipes" r ' +
      'WHERE NOT EXISTS (SELECT 1 FROM "recipe_ingredients" i WHERE i.recipe_id = r.id)',
  );
  return result('recipes have ingredients', empty, 'recipes without ingredients');
}

/**
 * The import rules (`checkRecipeRules`) over the imported recipes in the database: every recipe
 * not created through the API or the assistant. The detail lists each failing recipe with the
 * reasons.
 */
export async function checkImportedRecipes(
  prisma: PrismaClient,
  nutrition: NutritionService = new NutritionService(),
): Promise<CheckResult> {
  const recipes = await prisma.recipe.findMany({
    where: { source: { notIn: [RecipeSource.Manual, RecipeSource.Llm] } },
    include: { ingredients: { include: { foodItem: true }, orderBy: { position: SortOrder.Asc } } },
    orderBy: [{ source: SortOrder.Asc }, { sourceId: SortOrder.Asc }],
  });

  const failing = recipes.flatMap((recipe) => {
    const { reasons } = checkRecipeRules(
      {
        instructions: recipe.instructions,
        servings: recipe.servings,
        ingredients: recipe.ingredients.map((ingredient) => ({
          label: ingredient.foodItem?.name ?? ingredient.foodItemId,
          quantityG: ingredient.quantityG,
          isOptional: ingredient.isOptional,
          foodItem: ingredient.foodItem ?? null,
        })),
      },
      nutrition,
    );
    return reasons.length > 0 ? [`${recipe.sourceId ?? recipe.id} (${reasons.join('; ')})`] : [];
  });

  return {
    name: 'imported recipes pass the import rules',
    ok: failing.length === 0,
    detail: failing.length === 0 ? 'ok' : `${failing.length} recipes: ${failing.join(', ')}`,
  };
}

/** Loads each control recipe (source `seed`, slug) and runs the real `NutritionService` on it. */
export async function checkControlRecipes(
  prisma: PrismaClient,
  controls: ControlRecipe[],
  nutrition: NutritionService = new NutritionService(),
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const control of controls) {
    const name = `control ${control.slug}`;
    const recipe = await prisma.recipe.findUnique({
      where: { source_sourceId: { source: RecipeSource.Seed, sourceId: control.slug } },
      include: {
        ingredients: { include: { foodItem: true }, orderBy: { position: SortOrder.Asc } },
      },
    });
    if (!recipe) {
      results.push({ name, ok: false, detail: 'recipe not found (run npm run db:seed)' });
      continue;
    }

    const actual = nutrition.calculateRecipe(recipe);
    const mismatches = compareNutrition(control, actual);
    if (!actual.complete) mismatches.push('a counted ingredient has an unknown value');

    const { kcal, proteinG, fatG, carbsG } = actual.perServing;
    results.push({
      name,
      ok: mismatches.length === 0,
      detail:
        mismatches.length === 0
          ? `ok, per serving ${kcal} kcal, P ${proteinG} g, F ${fatG} g, C ${carbsG} g`
          : mismatches.join('; '),
    });
  }

  return results;
}

export async function summarize(prisma: PrismaClient): Promise<DataSummary> {
  const groups = await prisma.foodItem.groupBy({
    by: ['source'],
    _count: { _all: true },
    orderBy: [{ source: SortOrder.Asc }],
  });
  return {
    foodsBySource: Object.fromEntries(groups.map((g) => [g.source, g._count._all])),
    recipes: await prisma.recipe.count(),
    recipeIngredients: await prisma.recipeIngredient.count(),
  };
}

/** Every check; `ok` is false when any of them fails. */
export async function verifyData(
  prisma: PrismaClient,
  controls: ControlRecipe[],
): Promise<VerifyReport> {
  const checks = [
    ...(await checkForeignKeys(prisma)),
    ...(await checkDuplicateSources(prisma)),
    await checkRecipesHaveIngredients(prisma),
    await checkImportedRecipes(prisma),
    ...(await checkControlRecipes(prisma, controls)),
  ];
  return { ok: checks.every((c) => c.ok), checks, summary: await summarize(prisma) };
}

/** Human readable lines for the CLI. */
export function formatReport({ ok, checks, summary }: VerifyReport): string[] {
  const foods = Object.entries(summary.foodsBySource);
  const totalFoods = foods.reduce((sum, [, n]) => sum + n, 0);
  return [
    ...checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`),
    '',
    `foods: ${totalFoods} (${foods.map(([source, n]) => `${source} ${n}`).join(', ') || 'none'})`,
    `recipes: ${summary.recipes}, ingredients: ${summary.recipeIngredients}`,
    '',
    ok ? 'OK: every check passed' : `FAILED: ${checks.filter((c) => !c.ok).length} check(s)`,
  ];
}
