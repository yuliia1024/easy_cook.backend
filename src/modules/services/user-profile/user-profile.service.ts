import { Injectable } from '@nestjs/common';
import { ProfileNotFoundException } from '../../../common/exceptions';
import { UserProfile } from '../../data-access/user-profile/user-profile.entity';
import { UserProfileRepository } from '../../data-access/user-profile/user-profile.repository';

export type ProfileFields = Pick<UserProfile, 'firstName' | 'gender' | 'diet'>;

@Injectable()
export class UserProfileService {
  constructor(private readonly userProfileRepository: UserProfileRepository) {}

  public async save(userId: string, data: ProfileFields): Promise<UserProfile> {
    return this.userProfileRepository.upsert(userId, { ...data, firstName: data.firstName.trim() });
  }

  public async update(userId: string, data: Partial<ProfileFields>): Promise<UserProfile> {
    const profile = await this.userProfileRepository.findByUserId(userId);
    if (!profile) {
      throw new ProfileNotFoundException();
    }

    await this.userProfileRepository.update(userId, {
      ...data,
      ...(data.firstName !== undefined && { firstName: data.firstName.trim() }),
    });

    return this.userProfileRepository.findByUserId(userId);
  }
}
