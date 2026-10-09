import { PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Diet, FIRST_NAME_MAX_LENGTH, Gender } from '../../../../common/constants';

export class SaveProfileDto {
  /** @example Jane */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(FIRST_NAME_MAX_LENGTH)
  firstName: string;

  @IsEnum(Gender)
  gender: Gender;

  @IsEnum(Diet)
  diet: Diet;
}

export class UpdateProfileDto extends PartialType(SaveProfileDto) {}

export class ProfileOptionsResponseDto {
  genders: Gender[];
  diets: Diet[];
}
