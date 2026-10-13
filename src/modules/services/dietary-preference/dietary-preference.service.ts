import { Injectable } from '@nestjs/common';
import { DietaryPreference } from '../../../generated/prisma/client';
import {
  CONFLICTING_DIETS,
  DietTag,
  MAX_PREFERENCES,
  PreferenceType,
} from '../../../common/constants';
import {
  ConflictingDietsBadRequestException,
  DietaryPreferenceExistsConflictException,
  DietaryPreferenceNotFoundException,
  TooManyPreferencesBadRequestException,
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

  /**
   * Values are stored trimmed and lower-cased, so "Peanut" and "peanut " are one preference.
   * Diets must be known and compatible with the saved ones (no pescatarian + vegan).
   */
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

    const saved = await this.dietaryPreferenceRepository.findAll(profile.id);
    if (saved.length >= MAX_PREFERENCES) {
      throw new TooManyPreferencesBadRequestException(MAX_PREFERENCES);
    }
    if (normalized.preferenceType === PreferenceType.Diet) {
      const diets = saved
        .filter((preference) => preference.preferenceType === PreferenceType.Diet)
        .map((preference) => preference.value);
      const conflict = this.conflictingDiet(normalized.value, diets);
      if (conflict) {
        throw new ConflictingDietsBadRequestException(normalized.value, conflict);
      }
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

  private conflictingDiet(diet: string, saved: string[]): string | undefined {
    return CONFLICTING_DIETS.flatMap(([a, b]) => (diet === a ? [b] : diet === b ? [a] : [])).find(
      (other) => saved.includes(other),
    );
  }
}
