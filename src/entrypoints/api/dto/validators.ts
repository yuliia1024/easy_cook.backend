import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNumberString,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_REGEX,
} from '../../../common/constants';

export const IsUserEmail = (): PropertyDecorator =>
  applyDecorators(
    Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)),
    IsEmail(),
    MaxLength(254),
  );

export const IsUserPassword = (): PropertyDecorator =>
  applyDecorators(
    IsString(),
    MinLength(PASSWORD_MIN_LENGTH),
    MaxLength(PASSWORD_MAX_LENGTH),
    Matches(PASSWORD_REGEX, { message: 'password must contain at least one letter and one digit' }),
  );

export const IsOtpCode = (): PropertyDecorator =>
  applyDecorators(IsNumberString({ no_symbols: true }), Length(4, 10));
