import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserProfile } from './user-profile.entity';

type ProfileData = Pick<UserProfile, 'firstName' | 'gender' | 'diet'>;

@Injectable()
export class UserProfileRepository {
  constructor(
    @InjectRepository(UserProfile)
    private readonly repository: Repository<UserProfile>,
  ) {}

  public async findByUserId(userId: string): Promise<UserProfile | null> {
    return this.repository.findOneBy({ userId });
  }

  /** Insert-or-update on the unique `userId`, so two concurrent first saves cannot both insert. */
  public async upsert(userId: string, data: ProfileData): Promise<UserProfile> {
    await this.repository.upsert({ userId, ...data }, { conflictPaths: ['userId'] });
    return this.repository.findOneByOrFail({ userId });
  }

  public async update(userId: string, data: Partial<ProfileData>): Promise<void> {
    await this.repository.update({ userId }, data);
  }
}
