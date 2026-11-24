import { CustomDecorator, SetMetadata } from '@nestjs/common';
import { RateLimitName } from '../../../common/constants';

export const RATE_LIMIT_KEY = 'rateLimit';

/** Puts the route under a limit of its own (`RateLimitName`), on top of the default one. */
export const RateLimit = (name: Exclude<RateLimitName, RateLimitName.Default>): CustomDecorator =>
  SetMetadata(RATE_LIMIT_KEY, name);
