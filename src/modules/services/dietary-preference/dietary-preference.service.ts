import { Injectable } from '@nestjs/common';
import { DietaryPreference } from '../../../generated/prisma/client';
import {
  CONFLICTING_DIETS,
  DietTag,
  MAX_PREFERENCES,
  PreferenceChangeAction,
  PreferenceChangeStatus,
  PreferenceType,
} from '../../../common/constants';
import { PreferenceChange } from '../../../common/contracts';
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
    const { preferenceType, value } = this.normalize(data);
    const normalized = { preferenceType, value };
    if (await this.dietaryPreferenceRepository.findOne(profile.id, normalized)) {
      throw new DietaryPreferenceExistsConflictException();
    }
    await this.assertCanAdd(profile.id, normalized);
    return this.dietaryPreferenceRepository.create(profile.id, normalized);
  }

  /**
   * The change as it would be saved (`normalize`) and whether it is in effect already: the
   * preference exists for `add`, is absent for `remove`. Writes nothing; an `add` that `add` would
   * refuse is refused the same way (unknown or conflicting diet, too many preferences).
   */
  public async checkChange(
    change: PreferenceChange,
  ): Promise<{ change: PreferenceChange; inEffect: boolean }> {
    const profile = await this.userProfileService.getCurrent();
    const normalized = this.normalize(change);
    const existing = await this.dietaryPreferenceRepository.findOne(profile.id, normalized);
    if (normalized.action === PreferenceChangeAction.Remove) {
      return { change: normalized, inEffect: existing === null };
    }
    if (!existing) {
      await this.assertCanAdd(profile.id, normalized);
    }
    return { change: normalized, inEffect: existing !== null };
  }

  /**
   * Applies a change through `add` and `remove`, the same rules as the API. A change in effect
   * already is left as it is (`already_applied`), so applying twice writes once.
   */
  public async applyChange(change: PreferenceChange): Promise<PreferenceChangeStatus> {
    const profile = await this.userProfileService.getCurrent();
    const normalized = this.normalize(change);
    const existing = await this.dietaryPreferenceRepository.findOne(profile.id, normalized);
    if (normalized.action === PreferenceChangeAction.Add) {
      if (existing) {
        return PreferenceChangeStatus.AlreadyApplied;
      }
      await this.add(normalized);
      return PreferenceChangeStatus.Applied;
    }
    if (!existing) {
      return PreferenceChangeStatus.AlreadyApplied;
    }
    await this.dietaryPreferenceRepository.delete(existing.id);
    return PreferenceChangeStatus.Applied;
  }

  public async remove(id: string): Promise<void> {
    const profile = await this.userProfileService.getCurrent();
    if (!(await this.dietaryPreferenceRepository.findById(profile.id, id))) {
      throw new DietaryPreferenceNotFoundException();
    }
    await this.dietaryPreferenceRepository.delete(id);
  }

  /** Values are stored trimmed and lower-cased. */
  private normalize<T extends DietaryPreferenceData>(data: T): T {
    return { ...data, value: data.value.trim().toLowerCase() };
  }

  /** 400 for an unknown diet, too many preferences or a diet that conflicts with a saved one. */
  private async assertCanAdd(profileId: string, normalized: DietaryPreferenceData): Promise<void> {
    if (
      normalized.preferenceType === PreferenceType.Diet &&
      !Object.values<string>(DietTag).includes(normalized.value)
    ) {
      throw new UnknownDietBadRequestException(normalized.value);
    }
    const saved = await this.dietaryPreferenceRepository.findAll(profileId);
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
  }

  private conflictingDiet(diet: string, saved: string[]): string | undefined {
    return CONFLICTING_DIETS.flatMap(([a, b]) => (diet === a ? [b] : diet === b ? [a] : [])).find(
      (other) => saved.includes(other),
    );
  }
}
