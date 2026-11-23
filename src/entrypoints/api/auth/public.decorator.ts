import { CustomDecorator, SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** A route anyone may call, without a session (health, the sign-in itself). */
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC_KEY, true);
