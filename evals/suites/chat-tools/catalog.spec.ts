import { DietTag, MealType, SaveMenuStatus, SortOrder } from '../../../src/common/constants';
import {
  FoodItemsNotFoundBadRequestException,
  RecipeNotFoundException,
} from '../../../src/common/exceptions';
import {
  CATALOG_CONVERSATION_ID,
  CATALOG_FOODS,
  CATALOG_MENU_ID,
  CATALOG_MENU_VERSION_ID,
  CATALOG_PENDING_CHANGE,
  CATALOG_RECIPES,
  catalogChatTools,
  catalogFoodItemService,
  catalogRecipeSearchService,
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

  it('finds foods by every word of the search, in any order, like the repository', async () => {
    const { items } = await catalogFoodItemService.getPage(
      { search: 'boiled white rice' },
      firstPage,
    );
    expect(items.map(({ id }) => id)).toEqual([CATALOG_FOODS.rice.id]);
  });

  it('searches the recipes by the words of the query, Ukrainian too, most matches first', async () => {
    const names = async (text: string, filters = {}): Promise<string[]> =>
      (await catalogRecipeSearchService.search({ text, filters })).hits.map(
        ({ recipe }) => recipe.name,
      );

    await expect(names('скільки білка в курячому салаті')).resolves.toEqual([
      'Chicken salad',
      'Chicken with rice',
      'Grilled chicken with spinach',
    ]);
    await expect(names('суп із сочевиці')).resolves.toEqual(['Lentil soup']);
    await expect(names('salmon', { mealType: MealType.Dinner })).resolves.toEqual([
      'Baked salmon with spinach',
    ]);
    await expect(names('salmon', { mealType: MealType.Lunch })).resolves.toEqual([]);
    await expect(names('toast', { excludeAllergens: ['peanut'] })).resolves.toEqual([]);
    await expect(names('a menu')).resolves.toEqual([]);
  });

  it('runs the real chat tools on the catalog, with the nutrition the cases expect', async () => {
    const tools = catalogChatTools();

    await expect(
      tools.searchRecipes(
        {
          query: 'lentil soup',
          mealType: null,
          diet: null,
          maxKcalPerServing: null,
          maxPrepTimeMinutes: null,
          limit: null,
        },
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

  it('proposes a change and applies the pending one', async () => {
    const tools = catalogChatTools();
    await expect(
      tools.proposePreferenceChange({ ...CATALOG_PENDING_CHANGE, value: ' Peanut ' }),
    ).resolves.toMatchObject({ output: { change: CATALOG_PENDING_CHANGE } });
    await expect(tools.applyPreferenceChange(CATALOG_CONVERSATION_ID)).resolves.toMatchObject({
      output: { change: CATALOG_PENDING_CHANGE },
    });
  });

  it('saves the menu of the catalog conversation', async () => {
    await expect(catalogChatTools().saveMenu(CATALOG_CONVERSATION_ID)).resolves.toMatchObject({
      output: { status: SaveMenuStatus.Saved, title: '2-day menu' },
      event: { menuId: CATALOG_MENU_ID, versionId: CATALOG_MENU_VERSION_ID },
    });
  });
});
