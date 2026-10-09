import { buildProfile, buildUser } from '../../../test/fixtures';
import { UserProfileResponseDto, UserResponseDto } from './user.response.dto';

describe('UserResponseDto', () => {
  it('maps a user without a questionnaire', () => {
    const user = buildUser();

    expect(UserResponseDto.from(user)).toEqual({
      id: user.id,
      email: user.email,
      isEmailVerified: true,
      isProfileCompleted: false,
      profile: null,
      createdAt: user.createdAt,
    });
  });

  it('maps a user with a questionnaire', () => {
    const profile = buildProfile();
    const dto = UserResponseDto.from(buildUser({ profile }));

    expect(dto.isProfileCompleted).toBe(true);
    expect(dto.profile).toEqual(UserProfileResponseDto.from(profile));
  });

  it('never exposes the password hash or internal ids', () => {
    const dto = UserResponseDto.from(buildUser({ profile: buildProfile() }));

    expect(dto).not.toHaveProperty('password');
    expect(dto.profile).not.toHaveProperty('id');
    expect(dto.profile).not.toHaveProperty('userId');
  });
});
