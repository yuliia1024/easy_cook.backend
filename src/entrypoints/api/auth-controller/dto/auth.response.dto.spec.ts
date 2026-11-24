import { buildUser, USER_ID } from '../../../../test/fixtures';
import { AuthSessionResponseDto, AuthUserResponseDto } from './auth.response.dto';

describe('AuthSessionResponseDto', () => {
  const user = buildUser({ avatarUrl: 'https://lh3.googleusercontent.com/a/x' });

  it('gives the public fields of the user only', () => {
    expect(AuthUserResponseDto.from(user)).toEqual({
      id: USER_ID,
      email: 'cook@example.com',
      name: 'Cook',
      avatarUrl: user.avatarUrl,
    });
  });

  it('gives the user with the CSRF token', () => {
    expect(AuthSessionResponseDto.from(user, 'csrf')).toEqual({
      user: AuthUserResponseDto.from(user),
      csrfToken: 'csrf',
    });
  });
});
