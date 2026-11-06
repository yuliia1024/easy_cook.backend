import { DietTag, MealType, SortOrder } from '../../../src/common/constants';
import {
  FoodItemsNotFoundBadRequestException,
  RecipeNotFoundException,
} from '../../../src/common/exceptions';
import {
  CATALOG_FOODS,
  CATALOG_RECIPES,
  catalogChatTools,
  catalogFoodItemService,
  catalogRecipeService,
} from './catalog';

describe('chat-tools eval catalog', () => {
  const firstPage = { page: 1, limit: 100, sortOrder: SortOrder.Asc };

  it('has unique uuids for every recipe and food', () => {
    const ids = [
      ...CATALOG_RECIPES.map(({ id }) => id),
      ...Object.values(CATALOG_FOODS).map(({ id }) => id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[0-9a-f-]{36}$/.test(id))).toBe(true);
  });

  it('filters recipes by name, meal and diet groups like the repository, sorted by name', async () => {
    const { items, total } = await catalogRecipeService.getPage(
      { search: 'RICE', mealType: MealType.Lunch },
      firstPage,
    );
    expect(items.map(({ name }) => name)).toEqual(['Chicken with rice']);
    expect(total).toBe(1);

    const vegetarian = await catalogRecipeService.getPage(
      { mealType: MealType.Dinner, dietTypeGroups: [[DietTag.Vegetarian, DietTag.Vegan]] },
      firstPage,
    );
    expect(vegetarian.items.map(({ name }) => name)).toEqual([
      'Chickpea curry',
      'Tofu stir-fry with rice',
    ]);
  });

  it('pages and counts all matches', async () => {
    const { items, total } = await catalogRecipeService.getPage({}, { ...firstPage, limit: 2 });
    expect(items).toHaveLength(2);
    expect(total).toBe(CATALOG_RECIPES.length);
  });

  it('throws the app errors for an unknown recipe or food', async () => {
    await expect(catalogRecipeService.getById('nope')).rejects.toBeInstanceOf(
      RecipeNotFoundException,
    );
    await expect(
      catalogFoodItemService.getByIds([CATALOG_FOODS.rice.id, 'nope']),
    ).rejects.toBeInstanceOf(FoodItemsNotFoundBadRequestException);
  });

  it('finds foods by name and by id', async () => {
    const { items } = await catalogFoodItemService.getPage({ search: 'rice' }, firstPage);
    expect(items.map(({ name }) => name)).toEqual(['Rice, white, boiled']);
    const foods = await catalogFoodItemService.getByIds([CATALOG_FOODS.rice.id]);
    expect(foods.get(CATALOG_FOODS.rice.id)).toBe(CATALOG_FOODS.rice);
  });

  it('runs the real chat tools on the catalog, with the nutrition the cases expect', async () => {
    const tools = catalogChatTools();

    await expect(
      tools.searchRecipes(
        { query: 'lentil', mealType: null, diet: null, maxKcalPerServing: null, limit: null },
        null,
      ),
    ).resolves.toMatchObject({ recipes: [{ name: 'Lentil soup', perServing: { kcal: 261.5 } }] });
    await expect(tools.getFoodNutrition({ query: 'rice', quantityG: 150 })).resolves.toMatchObject({
      foods: [{ forQuantity: { kcal: 195 } }],
    });
    await expect(
      tools.calculateNutrition({
        items: [
          { foodId: CATALOG_FOODS.chicken.id, quantityG: 200 },
          { foodId: CATALOG_FOODS.rice.id, quantityG: 150 },
        ],
        servings: null,
      }),
    ).resolves.toMatchObject({ total: { proteinG: 66.1 } });
  });
});
