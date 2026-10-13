import { Injectable } from '@nestjs/common';
import { DietaryPreference } from '../../../generated/prisma/client';
import { DietTag, PreferenceType } from '../../../common/constants';
import {
  DietaryPreferenceExistsConflictException,
  DietaryPreferenceNotFoundException,
  UnknownDietBadRequestException,
} from '../../../common/exceptions';
import {
  DietaryPreferenceData,
  DietaryPreferenceRepository,
} from '../../data-access/dietary-preference/dietary-preference.repository';
import { UserProfileService } from '../user-profile/user-profile.service';

@Injectable()
export class DietaryPreferenceService {
  constructor(
    private readonly dietaryPreferenceRepository: DietaryPreferenceRepository,
    private readonly userProfileService: UserProfileService,
  ) {}

  public async getAll(): Promise<DietaryPreference[]> {
    const profile = await this.userProfileService.getCurrent();
    return this.dietaryPreferenceRepository.findAll(profile.id);
  }

  /** Values are stored trimmed and lower-cased, so "Peanut" and "peanut " are one preference. */
  public async add(data: DietaryPreferenceData): Promise<DietaryPreference> {
    const profile = await this.userProfileService.getCurrent();
    const normalized = { ...data, value: data.value.trim().toLowerCase() };

    if (
      normalized.preferenceType === PreferenceType.Diet &&
      !Object.values<string>(DietTag).includes(normalized.value)
    ) {
      throw new UnknownDietBadRequestException(normalized.value);
    }
    if (await this.dietaryPreferenceRepository.findOne(profile.id, normalized)) {
      throw new DietaryPreferenceExistsConflictException();
    }

    return this.dietaryPreferenceRepository.create(profile.id, normalized);
  }

  public async remove(id: string): Promise<void> {
    const profile = await this.userProfileService.getCurrent();
    if (!(await this.dietaryPreferenceRepository.findById(profile.id, id))) {
      throw new DietaryPreferenceNotFoundException();
    }
    await this.dietaryPreferenceRepository.delete(id);
  }
}
