import { Injectable } from '@nestjs/common';
import { UserProfile } from '../../../generated/prisma/client';
import { ProfileNotFoundException } from '../../../common/exceptions';
import {
  ProfileData,
  UserProfileRepository,
} from '../../data-access/user-profile/user-profile.repository';

/** One user, no auth: there is at most one profile and every request works with it. */
@Injectable()
export class UserProfileService {
  constructor(private readonly userProfileRepository: UserProfileRepository) {}

  public async getCurrent(): Promise<UserProfile> {
    const profile = await this.userProfileRepository.findCurrent();
    if (!profile) {
      throw new ProfileNotFoundException();
    }
    return profile;
  }

  /** Creates the profile on the first save, replaces its fields afterwards. */
  public async save(data: ProfileData): Promise<UserProfile> {
    const profile = await this.userProfileRepository.findCurrent();

    return profile
      ? this.userProfileRepository.update(profile.id, data)
      : this.userProfileRepository.create(data);
  }

  public async update(data: Partial<ProfileData>): Promise<UserProfile> {
    const profile = await this.getCurrent();
    return this.userProfileRepository.update(profile.id, data);
  }
}
