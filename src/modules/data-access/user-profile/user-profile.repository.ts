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

/** Single user app: the profile is the oldest (and only) row. */
@Injectable()
export class UserProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  public async findCurrent(): Promise<UserProfile | null> {
    return this.prisma.userProfile.findFirst({ orderBy: { createdAt: 'asc' } });
  }

  public async create(data: ProfileData): Promise<UserProfile> {
    return this.prisma.userProfile.create({ data });
  }

  public async update(id: string, data: Partial<ProfileData>): Promise<UserProfile> {
    return this.prisma.userProfile.update({ where: { id }, data });
  }
}
