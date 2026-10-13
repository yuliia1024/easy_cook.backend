import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DietTag, MealType } from '../../../../common/constants';
import { NutritionService } from '../../../../modules/services/nutrition/nutrition.service';
import { buildRecipe, FOOD_ID } from '../../../../test/fixtures';
import {
  CreateRecipeDto,
  RecipeIngredientDto,
  RecipeNutritionQueryDto,
  RecipeQueryDto,
  UpdateRecipeDto,
  UpdateRecipeIngredientDto,
} from './recipe.dto';
import { RecipeResponseDto } from './recipe.response.dto';

async function errorsOf<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain));
  return errors.map((e) => e.property);
}

describe('recipe DTOs', () => {
  const ingredient = { foodItemId: FOOD_ID, quantityG: 150 };
  const valid = {
    name: 'Soup',
    instructions: 'Boil',
    mealType: MealType.Lunch,
    dietType: [DietTag.Vegan],
    servings: 4,
    ingredients: [ingredient],
  };

  describe('RecipeIngredientDto', () => {
    it('accepts an ingredient with notes', async () => {
      expect(
        await errorsOf(RecipeIngredientDto, { ...ingredient, isOptional: true, notes: 'chop' }),
      ).toEqual([]);
    });

    it.each([
      [{ foodItemId: 'nope' }, 'foodItemId'],
      [{ quantityG: 0 }, 'quantityG'],
      [{ quantityG: -5 }, 'quantityG'],
      [{ quantityG: 1.234 }, 'quantityG'],
      [{ quantityG: '100' }, 'quantityG'],
      [{ isOptional: 'yes' }, 'isOptional'],
      [{ notes: 'x'.repeat(501) }, 'notes'],
    ])('rejects %p', async (patch, property) => {
      expect(await errorsOf(RecipeIngredientDto, { ...ingredient, ...patch })).toEqual([property]);
    });

    it('UpdateRecipeIngredientDto accepts any subset', async () => {
      expect(await errorsOf(UpdateRecipeIngredientDto, { quantityG: 10 })).toEqual([]);
      expect(await errorsOf(UpdateRecipeIngredientDto, { quantityG: 0 })).toEqual(['quantityG']);
    });
  });

  describe('CreateRecipeDto', () => {
    it('accepts a recipe', async () => {
      expect(await errorsOf(CreateRecipeDto, valid)).toEqual([]);
    });

    it('requires the core fields', async () => {
      expect(await errorsOf(CreateRecipeDto, {})).toEqual([
        'name',
        'instructions',
        'mealType',
        'servings',
        'ingredients',
      ]);
    });

    it.each([
      [{ mealType: 'brunch' }, 'mealType'],
      [{ dietType: ['carnivore'] }, 'dietType'],
      [{ dietType: [DietTag.Vegan, DietTag.Vegan] }, 'dietType'],
      [{ servings: 0 }, 'servings'],
      [{ servings: 1.5 }, 'servings'],
      [{ prepTimeMinutes: -1 }, 'prepTimeMinutes'],
      [{ source: 'blog' }, 'source'],
      [{ ingredients: [] }, 'ingredients'],
    ])('rejects %p', async (patch, property) => {
      expect(await errorsOf(CreateRecipeDto, { ...valid, ...patch })).toEqual([property]);
    });

    it('validates nested ingredients', async () => {
      const errors = await validate(
        plainToInstance(CreateRecipeDto, { ...valid, ingredients: [{ foodItemId: FOOD_ID }] }),
      );

      expect(errors[0].property).toBe('ingredients');
      expect(errors[0].children[0].children[0].property).toBe('quantityG');
    });
  });

  it('UpdateRecipeDto validates only the given fields', async () => {
    expect(await errorsOf(UpdateRecipeDto, { servings: 2 })).toEqual([]);
    expect(await errorsOf(UpdateRecipeDto, { ingredients: [] })).toEqual(['ingredients']);
  });

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
});
