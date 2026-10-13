import { DietaryPreference } from '../../../../generated/prisma/client';
import { PreferenceType } from '../../../../common/constants';

export class PreferenceResponseDto {
  id: string;
  preferenceType: PreferenceType;
  value: string;

  static from(preference: DietaryPreference): PreferenceResponseDto {
    return {
      id: preference.id,
      preferenceType: preference.preferenceType as PreferenceType,
      value: preference.value,
    };
  }
}
