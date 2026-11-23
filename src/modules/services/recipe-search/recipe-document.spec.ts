import { RECIPE_DOCUMENT_VERSION } from '../../../common/constants';
import {
  buildFoodItem,
  buildIngredient,
  buildRecipe,
  FOOD_ID,
  RECIPE_ID,
} from '../../../test/fixtures';
import { buildRecipeDocument, foodSearchName, translatedFoodSearchName } from './recipe-document';

describe('foodSearchName', () => {
  it.each([
    ['Chicken breast, raw', 'Chicken breast'],
    ['Fish, flatfish (flounder and sole species), raw', 'Fish flatfish'],
    ['Pumpkin, canned, without salt', 'Pumpkin'],
    ['Ground beef 10% fat, raw', 'Ground beef 10% fat'],
    ['Corn, sweet, yellow, frozen, kernels cut off cob, unprepared', 'Corn sweet yellow'],
    ['Milk 2%', 'Milk 2%'],
    ['Raw', 'Raw'],
  ])('%p -> %p', (name, expected) => {
    expect(foodSearchName(name)).toBe(expected);
  });
});

describe('translatedFoodSearchName', () => {
  it.each([
    ['Куряче філе, сире', 'Куряче філе'],
    ['Риба камбала (морський язик), сира', 'Риба камбала'],
    ['Молоко 2%', 'Молоко 2%'],
  ])('%p -> %p', (name, expected) => {
    expect(translatedFoodSearchName(name)).toBe(expected);
  });
});

describe('buildRecipeDocument', () => {
  const recipe = buildRecipe({
    name: ' Salmon with rice ',
    description: 'A light dinner.',
    instructions: 'Bake the salmon.\n\nServe   with rice.',
    mealType: 'dinner',
    dietType: ['pescatarian', 'gluten_free'],
    prepTimeMinutes: 25,
    ingredients: [
      buildIngredient({ foodItem: buildFoodItem({ name: 'Fish, salmon, Atlantic, raw' }) }),
      buildIngredient({ foodItem: buildFoodItem({ name: 'White rice, boiled' }) }),
      buildIngredient({ foodItem: buildFoodItem({ name: 'White rice, boiled' }) }),
    ],
  });

  it('puts the name first, then the meal, diets, time, ingredients and the method', () => {
    expect(buildRecipeDocument(recipe)).toEqual({
      recipeId: RECIPE_ID,
      documentVersion: RECIPE_DOCUMENT_VERSION,
      content: [
        'Salmon with rice',
        'A light dinner.',
        'Meal: dinner. Diet: pescatarian, gluten-free. Ready in 25 minutes.',
        'Ingredients: Fish salmon Atlantic, White rice.',
        'Method: Bake the salmon. Serve with rice.',
      ].join('\n'),
      contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('leaves out what the recipe does not have', () => {
    const { content } = buildRecipeDocument(
      buildRecipe({
        name: 'Tea',
        description: null,
        dietType: [],
        prepTimeMinutes: null,
        ingredients: [],
        instructions: 'Brew.',
        mealType: 'snack',
      }),
    );

    expect(content).toBe('Tea\nMeal: snack.\nMethod: Brew.');
  });

  it('cuts long instructions on a word', () => {
    const { content } = buildRecipeDocument(
      buildRecipe({ instructions: 'stir well '.repeat(200) }),
    );
    const method = content.split('\n').at(-1)!;

    expect(method.length).toBeLessThanOrEqual('Method: '.length + 603);
    expect(method).toMatch(/well\.\.\.$/);
  });

  it('hashes the content: the same recipe gives the same hash, a change another one', () => {
    const first = buildRecipeDocument(recipe);

    expect(buildRecipeDocument(recipe).contentHash).toBe(first.contentHash);
    expect(buildRecipeDocument({ ...recipe, name: 'Trout with rice' }).contentHash).not.toBe(
      first.contentHash,
    );
  });

  it('adds the translated name, description and ingredients after the English text', () => {
    const updatedAt = new Date();
    const translated = buildRecipe({
      name: 'Rice',
      description: null,
      dietType: [],
      prepTimeMinutes: null,
      instructions: 'Boil.',
      mealType: 'lunch',
      translations: [
        {
          recipeId: RECIPE_ID,
          locale: 'uk',
          name: 'Рис',
          description: 'Проста страва.',
          instructions: 'Зваріть.',
          updatedAt,
        },
      ],
      ingredients: [
        buildIngredient({
          foodItem: buildFoodItem({
            name: 'White rice, boiled',
            translations: [
              { foodItemId: FOOD_ID, locale: 'uk', name: 'Рис білий, варений', updatedAt },
            ],
          }),
        }),
        buildIngredient({ foodItem: buildFoodItem({ name: 'Salt' }) }),
      ],
    });

    expect(buildRecipeDocument(translated).content).toBe(
      [
        'Rice',
        'Meal: lunch.',
        'Ingredients: White rice, Salt.',
        'Method: Boil.',
        'Name (uk): Рис',
        'Description (uk): Проста страва.',
        'Ingredients (uk): Рис білий.',
      ].join('\n'),
    );
  });
});
