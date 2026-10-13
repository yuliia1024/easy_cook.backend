import { Injectable } from '@nestjs/common';
import { RecipeIngredient } from '../../../generated/prisma/client';
import { PrismaService } from '../../../providers/prisma/prisma.service';
import { IngredientData } from '../recipe/recipe.repository';

@Injectable()
export class RecipeIngredientRepository {
  constructor(private readonly prisma: PrismaService) {}

  public async findOne(recipeId: string, id: string): Promise<RecipeIngredient | null> {
    return this.prisma.recipeIngredient.findFirst({ where: { id, recipeId } });
  }

  /** Appended after the last ingredient. */
  public async create(recipeId: string, data: IngredientData): Promise<RecipeIngredient> {
    const { _max } = await this.prisma.recipeIngredient.aggregate({
      where: { recipeId },
      _max: { position: true },
    });
    return this.prisma.recipeIngredient.create({
      data: { recipeId, ...data, position: (_max.position ?? -1) + 1 },
    });
  }

  public async update(id: string, data: Partial<IngredientData>): Promise<RecipeIngredient> {
    return this.prisma.recipeIngredient.update({ where: { id }, data });
  }

  public async delete(id: string): Promise<void> {
    await this.prisma.recipeIngredient.delete({ where: { id } });
  }
}
