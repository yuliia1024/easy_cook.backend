import { FOOD_ID, INGREDIENT_ID, RECIPE_ID } from '../../../test/fixtures';
import { createPrismaMock, PrismaMock } from '../../../test/prisma-mock';
import { RecipeIngredientRepository } from './recipe-ingredient.repository';

describe('RecipeIngredientRepository', () => {
  let prisma: PrismaMock;
  let repository: RecipeIngredientRepository;
  const data = { foodItemId: FOOD_ID, quantityG: 50 };

  beforeEach(() => {
    prisma = createPrismaMock();
    repository = new RecipeIngredientRepository(prisma);
  });

  it('finds an ingredient only within its recipe', async () => {
    await repository.findOne(RECIPE_ID, INGREDIENT_ID);

    expect(prisma.recipeIngredient.findFirst).toHaveBeenCalledWith({
      where: { id: INGREDIENT_ID, recipeId: RECIPE_ID },
    });
  });

  describe('create', () => {
    it('appends after the last position', async () => {
      prisma.recipeIngredient.aggregate.mockResolvedValue({ _max: { position: 4 } } as never);

      await repository.create(RECIPE_ID, data);

      expect(prisma.recipeIngredient.aggregate).toHaveBeenCalledWith({
        where: { recipeId: RECIPE_ID },
        _max: { position: true },
      });
      expect(prisma.recipeIngredient.create).toHaveBeenCalledWith({
        data: { recipeId: RECIPE_ID, ...data, position: 5 },
      });
    });

    it('starts at 0 for an empty recipe', async () => {
      prisma.recipeIngredient.aggregate.mockResolvedValue({ _max: { position: null } } as never);

      await repository.create(RECIPE_ID, data);

      expect(prisma.recipeIngredient.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ position: 0 }),
      });
    });
  });

  it('updates and deletes by id', async () => {
    await repository.update(INGREDIENT_ID, { quantityG: 10 });
    await repository.delete(INGREDIENT_ID);

    expect(prisma.recipeIngredient.update).toHaveBeenCalledWith({
      where: { id: INGREDIENT_ID },
      data: { quantityG: 10 },
    });
    expect(prisma.recipeIngredient.delete).toHaveBeenCalledWith({ where: { id: INGREDIENT_ID } });
  });
});
