import { Injectable } from '@nestjs/common';
import { UserProfile } from '../../../generated/prisma/client';
import { PrismaService } from '../../../providers/prisma/prisma.service';

export interface ProfileData {
  age: number;
  heightCm: number;
  weightKg: number;
  sex: string;
  activityLevel: string;
  goal: string;
}

/** One profile per user (`user_id` is unique). */
@Injectable()
export class UserProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  public async findByUserId(userId: string): Promise<UserProfile | null> {
    return this.prisma.userProfile.findUnique({ where: { userId } });
  }

  /** Creates the profile of the user or replaces its fields, in one statement (no race on the first save). */
  public async upsert(userId: string, data: ProfileData): Promise<UserProfile> {
    return this.prisma.userProfile.upsert({
      where: { userId },
      create: { ...data, userId },
      update: data,
    });
  }

  public async update(id: string, data: Partial<ProfileData>): Promise<UserProfile> {
    return this.prisma.userProfile.update({ where: { id }, data });
  }
}
