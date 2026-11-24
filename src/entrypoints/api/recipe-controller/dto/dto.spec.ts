import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DietTag } from '../../../../common/constants';
import { NutritionService } from '../../../../modules/services/nutrition/nutrition.service';
import {
  buildFoodItem,
  buildIngredient,
  buildRecipe,
  FOOD_ID,
  INGREDIENT_ID,
  RECIPE_ID,
} from '../../../../test/fixtures';
import { RecipeNutritionQueryDto, RecipeQueryDto } from './recipe.dto';
import { RecipeResponseDto } from './recipe.response.dto';

async function errorsOf<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain));
  return errors.map((e) => e.property);
}

describe('recipe DTOs', () => {
  describe('RecipeQueryDto', () => {
    it('reads diet tags from repeated or comma separated params', async () => {
      const dto = plainToInstance(RecipeQueryDto, {
        dietType: 'vegan,gluten_free',
        mealType: 'lunch',
      });

      expect(await validate(dto)).toHaveLength(0);
      expect(dto.dietType).toEqual([DietTag.Vegan, DietTag.GlutenFree]);
    });

    it('rejects an unknown tag', async () => {
      expect(await errorsOf(RecipeQueryDto, { dietType: ['vegan', 'paleo'] })).toEqual([
        'dietType',
      ]);
    });
  });

  it('RecipeNutritionQueryDto parses the flag', () => {
    expect(
      plainToInstance(RecipeNutritionQueryDto, { includeOptional: 'true' }).includeOptional,
    ).toBe(true);
  });

  it('RecipeResponseDto maps ingredients and adds the per-serving nutrition', () => {
    const recipe = buildRecipe();
    const dto = RecipeResponseDto.from(recipe, new NutritionService().calculateRecipe(recipe));

    expect(dto.ingredients[0]).toMatchObject({
      foodItemId: FOOD_ID,
      quantityG: 200,
      position: 0,
      foodItem: { kcalPer100g: 130 },
    });
    // 200 g boiled rice = 260 kcal, 2 servings
    expect(dto.nutritionPerServing.kcal).toBe(130);
    expect(dto.nutritionComplete).toBe(true);
  });

  it('RecipeResponseDto maps the translations of the recipe, its notes and foods by locale', () => {
    const updatedAt = new Date();
    const recipe = buildRecipe({
      description: 'Light.',
      translations: [
        {
          recipeId: RECIPE_ID,
          locale: 'uk',
          name: 'Рис з овочами',
          description: 'Легка страва.',
          instructions: 'Зваріть рис.',
          updatedAt,
        },
      ],
      ingredients: [
        buildIngredient({
          notes: 'chopped',
          translations: [
            { recipeIngredientId: INGREDIENT_ID, locale: 'uk', notes: 'подрібнити', updatedAt },
          ],
          foodItem: buildFoodItem({
            translations: [{ foodItemId: FOOD_ID, locale: 'uk', name: 'Рис, варений', updatedAt }],
          }),
        }),
      ],
    });
    const dto = RecipeResponseDto.from(recipe, new NutritionService().calculateRecipe(recipe));

    expect(dto.translations).toEqual({
      uk: { name: 'Рис з овочами', description: 'Легка страва.', instructions: 'Зваріть рис.' },
    });
    expect(dto.ingredients[0].translations).toEqual({ uk: { notes: 'подрібнити' } });
    expect(dto.ingredients[0].foodItem.translations).toEqual({ uk: { name: 'Рис, варений' } });
    const plain = buildRecipe();
    expect(
      RecipeResponseDto.from(plain, new NutritionService().calculateRecipe(plain)).translations,
    ).toEqual({});
  });
});
