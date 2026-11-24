import { Injectable } from '@nestjs/common';
import { UserProfile } from '../../../generated/prisma/client';
import { BMI_LIMITS, Goal, UNDERWEIGHT_BMI } from '../../../common/constants';
import {
  ImplausibleBmiBadRequestException,
  ProfileNotFoundException,
  SessionRequiredUnauthorizedException,
  WeightLossUnderweightBadRequestException,
} from '../../../common/exceptions';
import { getCurrentUserId } from '../../../common/logger';
import { toNumber } from '../../../common/utils';
import {
  ProfileData,
  UserProfileRepository,
} from '../../data-access/user-profile/user-profile.repository';

/**
 * The profile of the signed-in user (`SessionGuard` puts the user into the request context): every
 * per-user service reaches its data through it, so one user never sees another's.
 */
@Injectable()
export class UserProfileService {
  constructor(private readonly userProfileRepository: UserProfileRepository) {}

  public async getCurrent(): Promise<UserProfile> {
    const profile = await this.findCurrent();
    if (!profile) {
      throw new ProfileNotFoundException();
    }
    return profile;
  }

  /** The profile, or null until it is filled in. */
  public async findCurrent(): Promise<UserProfile | null> {
    return this.userProfileRepository.findByUserId(this.currentUserId());
  }

  /** Creates the profile on the first save, replaces its fields afterwards. */
  public async save(data: ProfileData): Promise<UserProfile> {
    this.assertHealthy(data);
    return this.userProfileRepository.upsert(this.currentUserId(), data);
  }

  public async update(data: Partial<ProfileData>): Promise<UserProfile> {
    const profile = await this.getCurrent();
    this.assertHealthy({
      heightCm: toNumber(profile.heightCm),
      weightKg: toNumber(profile.weightKg),
      goal: profile.goal,
      ...data,
    });
    return this.userProfileRepository.update(profile.id, data);
  }

  /** 401 outside a signed-in request: never falls back to some profile. */
  private currentUserId(): string {
    const userId = getCurrentUserId();
    if (!userId) {
      throw new SessionRequiredUnauthorizedException();
    }
    return userId;
  }

  /** The BMI must be plausible, and an underweight profile cannot aim to lose weight. */
  private assertHealthy({
    heightCm,
    weightKg,
    goal,
  }: Pick<ProfileData, 'heightCm' | 'weightKg' | 'goal'>): void {
    const bmi = weightKg / (heightCm / 100) ** 2;
    if (bmi < BMI_LIMITS.min || bmi > BMI_LIMITS.max) {
      throw new ImplausibleBmiBadRequestException(bmi);
    }
    if (goal === Goal.LoseWeight && bmi < UNDERWEIGHT_BMI) {
      throw new WeightLossUnderweightBadRequestException(UNDERWEIGHT_BMI);
    }
  }
}
