import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { PREFERENCE_VALUE_MAX_LENGTH, PreferenceType } from '../../../../common/constants';
import { Trim } from '../../dto/validators';

export class CreatePreferenceDto {
  @IsEnum(PreferenceType)
  preferenceType: PreferenceType;

  /** A `DietTag` for `diet`, free text otherwise (e.g. "peanut", "mushrooms"). @example peanut */
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PREFERENCE_VALUE_MAX_LENGTH)
  value: string;
}
