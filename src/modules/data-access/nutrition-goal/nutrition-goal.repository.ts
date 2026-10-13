import { Injectable } from '@nestjs/common';
import { NutritionGoal } from '../../../generated/prisma/client';
import { PrismaService } from '../../../providers/prisma/prisma.service';
import { SortOrder } from '../../../common/constants';

export interface NutritionGoalData {
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  calculationMode: string;
  ruleVersion: string | null;
  effectiveFrom?: Date;
}

/** Goals are append-only: a change is a new row, history stays as it was. */
@Injectable()
export class NutritionGoalRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The latest goal already in effect at `at`. */
  public async findCurrent(
    profileId: string,
    at: Date = new Date(),
  ): Promise<NutritionGoal | null> {
    return this.prisma.nutritionGoal.findFirst({
      where: { profileId, effectiveFrom: { lte: at } },
      orderBy: { effectiveFrom: SortOrder.Desc },
    });
  }

  /** Ordered by `effectiveFrom`. */
  public async findAll(profileId: string, sortOrder: SortOrder): Promise<NutritionGoal[]> {
    return this.prisma.nutritionGoal.findMany({
      where: { profileId },
      orderBy: { effectiveFrom: sortOrder },
    });
  }

  public async create(profileId: string, data: NutritionGoalData): Promise<NutritionGoal> {
    return this.prisma.nutritionGoal.create({ data: { profileId, ...data } });
  }
}
