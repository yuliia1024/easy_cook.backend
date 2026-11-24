import { User } from '../../../../generated/prisma/client';

export class AuthUserResponseDto {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;

  static from(user: User): AuthUserResponseDto {
    return { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl };
  }
}

/** The signed-in user and the CSRF token to send in `X-CSRF-Token` on every unsafe request. */
export class AuthSessionResponseDto {
  user: AuthUserResponseDto;
  csrfToken: string;

  static from(user: User, csrfToken: string): AuthSessionResponseDto {
    return { user: AuthUserResponseDto.from(user), csrfToken };
  }
}

export class LoginNonceResponseDto {
  /** Pass to `google.accounts.id.initialize({ nonce })`; one sign-in, 10 minutes. */
  nonce: string;
}
