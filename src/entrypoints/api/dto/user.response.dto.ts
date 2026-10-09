import { Diet, Gender } from '../../../common/constants';
import { UserProfile } from '../../../modules/data-access/user-profile/user-profile.entity';
import { User } from '../../../modules/data-access/user/user.entity';

export class UserProfileResponseDto {
  firstName: string;
  gender: Gender;
  diet: Diet;
  updatedAt: Date;

  static from(profile: UserProfile): UserProfileResponseDto {
    return {
      firstName: profile.firstName,
      gender: profile.gender,
      diet: profile.diet,
      updatedAt: profile.updatedAt,
    };
  }
}

export class UserResponseDto {
  id: string;
  email: string;
  isEmailVerified: boolean;
  /** False until the questionnaire (`PUT /users/me/profile`) is filled in. */
  isProfileCompleted: boolean;
  profile: UserProfileResponseDto | null;
  createdAt: Date;

  static from(user: User): UserResponseDto {
    return {
      id: user.id,
      email: user.email,
      isEmailVerified: user.isEmailVerified,
      isProfileCompleted: !!user.profile,
      profile: user.profile ? UserProfileResponseDto.from(user.profile) : null,
      createdAt: user.createdAt,
    };
  }
}
