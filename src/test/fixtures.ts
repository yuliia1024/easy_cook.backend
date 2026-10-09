import { Diet, Gender } from '../common/constants';
import { UserProfile } from '../modules/data-access/user-profile/user-profile.entity';
import { User } from '../modules/data-access/user/user.entity';

export const USER_ID = '11111111-1111-4111-8111-111111111111';
export const SESSION_ID = '22222222-2222-4222-8222-222222222222';

export function buildProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return Object.assign(new UserProfile(), {
    id: '33333333-3333-4333-8333-333333333333',
    userId: USER_ID,
    firstName: 'Jane',
    gender: Gender.Female,
    diet: Diet.Vegan,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  });
}

export function buildUser(overrides: Partial<User> = {}): User {
  return Object.assign(new User(), {
    id: USER_ID,
    email: 'jane@example.com',
    password: 'hashed-password',
    isEmailVerified: true,
    emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
    lastLoginAt: null,
    profile: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });
}
