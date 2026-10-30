import { Allergen, DietTag, FoodCategory } from '../../src/common/constants';
import {
  classifyRecipe,
  classifyRecipes,
  FoodCategories,
  foodCategoriesOf,
  formatClassificationReport,
  seedDietType,
} from './classify-recipes';
import { SeedData, SeedRecipe } from './seed-data';

describe('classify recipes', () => {
  const categoriesOf: FoodCategories = new Map([
    ['rice', [FoodCategory.Grain]],
    ['tofu', [FoodCategory.Soy, FoodCategory.Legume]],
    ['honey', [FoodCategory.Honey]],
    ['cheese', [FoodCategory.Dairy]],
    ['egg-noodles', [FoodCategory.GlutenGrain, FoodCategory.Egg]],
    ['salmon', [FoodCategory.Fish]],
    ['shrimp', [FoodCategory.Shellfish]],
    ['chicken', [FoodCategory.Poultry]],
    ['pesto', [FoodCategory.Condiment, FoodCategory.Dairy, FoodCategory.TreeNut]],
  ]);
  const recipe = (foods: string[], patch: Partial<SeedRecipe> = {}): SeedRecipe => ({
    slug: 'dish',
    name: 'Dish',
    instructions: 'Cook',
    mealType: 'lunch',
    dietType: [],
    servings: 2,
    ingredients: foods.map((food) => ({ food, quantityG: 100 })),
    ...patch,
  });

  describe('classifyRecipe', () => {
    it.each([
      [
        ['rice', 'tofu'],
        [DietTag.Vegan, DietTag.GlutenFree, DietTag.DairyFree],
      ],
      [
        ['rice', 'honey'],
        [DietTag.Vegetarian, DietTag.GlutenFree, DietTag.DairyFree],
      ],
      [
        ['rice', 'cheese'],
        [DietTag.Vegetarian, DietTag.GlutenFree],
      ],
      [
        ['rice', 'salmon'],
        [DietTag.Pescatarian, DietTag.GlutenFree, DietTag.DairyFree],
      ],
      [
        ['rice', 'shrimp'],
        [DietTag.Pescatarian, DietTag.GlutenFree, DietTag.DairyFree],
      ],
      [
        ['chicken', 'salmon'],
        [DietTag.GlutenFree, DietTag.DairyFree],
      ],
      [['egg-noodles', 'cheese'], [DietTag.Vegetarian]],
      [['chicken', 'egg-noodles', 'cheese'], []],
    ])('derives the diet tags of %p from the food categories', (foods, dietType) => {
      expect(classifyRecipe(recipe(foods), categoriesOf).dietType).toEqual(dietType);
    });

    it('derives the allergens once each, in Allergen order', () => {
      expect(
        classifyRecipe(recipe(['pesto', 'egg-noodles', 'cheese', 'tofu']), categoriesOf).allergens,
      ).toEqual([Allergen.Gluten, Allergen.Milk, Allergen.Egg, Allergen.TreeNut, Allergen.Soy]);
    });

    it('counts optional ingredients too', () => {
      const dish = recipe(['rice']);
      dish.ingredients.push({ food: 'cheese', quantityG: 10, isOptional: true });

      expect(classifyRecipe(dish, categoriesOf)).toEqual({
        dietType: [DietTag.Vegetarian, DietTag.GlutenFree],
        allergens: [Allergen.Milk],
      });
    });

    it('throws on a food without categories', () => {
      expect(() => classifyRecipe(recipe(['bread']), categoriesOf)).toThrow(
        'dish: food bread has no categories',
      );
    });
  });

  describe('seedDietType', () => {
    it('replaces the derived tags of the source and keeps the others', () => {
      const dish = recipe(['rice', 'salmon'], {
        dietType: [DietTag.HighProtein, DietTag.Vegetarian, DietTag.LowCarb],
      });

      expect(seedDietType(dish, categoriesOf)).toEqual([
        DietTag.Pescatarian,
        DietTag.GlutenFree,
        DietTag.DairyFree,
        DietTag.HighProtein,
        DietTag.LowCarb,
      ]);
    });
  });

  describe('classifyRecipes', () => {
    const data = (recipes: SeedRecipe[]): SeedData => ({
      foods: [],
      importedFoods: [],
      recipes,
      foodCategories: [
        { food: 'rice', name: 'Rice', categories: [FoodCategory.Grain] },
        { food: 'salmon', name: 'Salmon', categories: [FoodCategory.Fish] },
        { food: 'shrimp', name: 'Shrimp', categories: [FoodCategory.Shellfish] },
      ],
    });

    it('reads the categories of the seed data into a map', () => {
      expect(foodCategoriesOf(data([])).get('salmon')).toEqual([FoodCategory.Fish]);
    });

    it('reports source tags the ingredients contradict, with the foods that do', () => {
      const dish = recipe(['rice', 'salmon', 'shrimp'], {
        dietType: [DietTag.Vegetarian, DietTag.GlutenFree, DietTag.DairyFree],
      });

      expect(classifyRecipes(data([dish]))).toEqual([
        {
          slug: 'dish',
          dietType: [DietTag.Pescatarian, DietTag.GlutenFree, DietTag.DairyFree],
          allergens: [Allergen.Fish, Allergen.Shellfish],
          contradicted: [{ tag: DietTag.Vegetarian, foods: ['salmon', 'shrimp'] }],
          untagged: [DietTag.Pescatarian],
        },
      ]);
    });

    it('accepts a looser source tag that a stricter derived one satisfies', () => {
      const dish = recipe(['rice'], { dietType: [DietTag.Vegetarian, DietTag.HighProtein] });

      expect(classifyRecipes(data([dish]))[0]).toMatchObject({
        contradicted: [],
        untagged: [DietTag.Vegan, DietTag.GlutenFree, DietTag.DairyFree],
      });
    });
  });

  describe('formatClassificationReport', () => {
    it('lists the recipes that differ from their source and sums them up', () => {
      const base = { dietType: [], allergens: [], contradicted: [], untagged: [] };

      expect(
        formatClassificationReport([
          { ...base, slug: 'same' },
          {
            ...base,
            slug: 'fish-bowl',
            contradicted: [{ tag: DietTag.Vegetarian, foods: ['salmon'] }],
            untagged: [DietTag.Pescatarian],
          },
          { ...base, slug: 'rice', untagged: [DietTag.Vegan] },
        ]),
      ).toEqual([
        'fish-bowl: not vegetarian (salmon); also pescatarian',
        'rice: also vegan',
        '3 recipes: 1 with a source tag the ingredients contradict, ' +
          '2 with a derived tag the source misses',
      ]);
    });
  });

  it('the committed seed recipes agree with the tags derived from their foods', () => {
    const { loadSeedData } = jest.requireActual<typeof import('./seed-data')>('./seed-data');
    const reports = classifyRecipes(loadSeedData());

    expect(reports.filter((r) => r.contradicted.length > 0)).toEqual([]);
  });
});
