import { Injectable } from '@nestjs/common';
import { DietaryPreference } from '../../../generated/prisma/client';
import { PrismaService } from '../../../providers/prisma/prisma.service';

export interface DietaryPreferenceData {
  preferenceType: string;
  value: string;
}

@Injectable()
export class DietaryPreferenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  public async findAll(profileId: string): Promise<DietaryPreference[]> {
    return this.prisma.dietaryPreference.findMany({
      where: { profileId },
      orderBy: [{ preferenceType: 'asc' }, { value: 'asc' }],
    });
  }

  public async findById(profileId: string, id: string): Promise<DietaryPreference | null> {
    return this.prisma.dietaryPreference.findFirst({ where: { id, profileId } });
  }

  public async findOne(
    profileId: string,
    { preferenceType, value }: DietaryPreferenceData,
  ): Promise<DietaryPreference | null> {
    return this.prisma.dietaryPreference.findUnique({
      where: { profileId_preferenceType_value: { profileId, preferenceType, value } },
    });
  }

  public async create(profileId: string, data: DietaryPreferenceData): Promise<DietaryPreference> {
    return this.prisma.dietaryPreference.create({ data: { profileId, ...data } });
  }

  public async delete(id: string): Promise<void> {
    await this.prisma.dietaryPreference.delete({ where: { id } });
  }
}
