import { EntityManager } from 'typeorm';
import { UserNotFoundException } from '../../../common/exceptions';
import { createMock } from '../../../test/create-mock';
import { buildUser, USER_ID } from '../../../test/fixtures';
import { UserRepository } from '../../data-access/user/user.repository';
import { PasswordService } from '../password/password.service';
import { UserService } from './user.service';

describe('UserService', () => {
  let repository: jest.Mocked<UserRepository>;
  let passwordService: jest.Mocked<PasswordService>;
  let service: UserService;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-08T12:00:00Z') });
    repository = createMock<UserRepository>();
    passwordService = createMock<PasswordService>();
    passwordService.hash.mockResolvedValue('hashed');
    service = new UserService(repository, passwordService);
  });

  afterEach(() => jest.useRealTimers());

  it('normalizes emails to trimmed lower case', () => {
    expect(UserService.normalizeEmail('  Jane@Example.COM ')).toBe('jane@example.com');
  });

  describe('getById', () => {
    it('returns the user', async () => {
      const user = buildUser();
      repository.findById.mockResolvedValue(user);

      await expect(service.getById(USER_ID)).resolves.toBe(user);
    });

    it('throws for an unknown user', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.getById(USER_ID)).rejects.toBeInstanceOf(UserNotFoundException);
    });
  });

  it('looks users up by the normalized email', async () => {
    await service.findByEmail('JANE@example.com ');
    await service.findByEmailWithPassword('JANE@example.com');
    await service.isEmailTaken(' Jane@example.com');

    expect(repository.findByEmail).toHaveBeenCalledWith('jane@example.com');
    expect(repository.findByEmailWithPassword).toHaveBeenCalledWith('jane@example.com');
    expect(repository.existsByEmail).toHaveBeenCalledWith('jane@example.com');
  });

  it('creates a user with a normalized email and a hashed password', async () => {
    const manager = createMock<EntityManager>();

    await service.create('Jane@Example.com', 'Secret123', manager);

    expect(passwordService.hash).toHaveBeenCalledWith('Secret123');
    expect(repository.create).toHaveBeenCalledWith(
      { email: 'jane@example.com', password: 'hashed' },
      manager,
    );
  });

  it('marks the email verified with a timestamp', async () => {
    await service.markEmailVerified(USER_ID);

    expect(repository.update).toHaveBeenCalledWith(USER_ID, {
      isEmailVerified: true,
      emailVerifiedAt: new Date('2026-10-08T12:00:00Z'),
    });
  });

  it('records the login time', async () => {
    await service.markLoggedIn(USER_ID);

    expect(repository.update).toHaveBeenCalledWith(USER_ID, {
      lastLoginAt: new Date('2026-10-08T12:00:00Z'),
    });
  });

  it('stores a new password hashed', async () => {
    await service.setPassword(USER_ID, 'NewSecret1');

    expect(passwordService.hash).toHaveBeenCalledWith('NewSecret1');
    expect(repository.update).toHaveBeenCalledWith(USER_ID, { password: 'hashed' });
  });

  it('checks a password against the stored hash', async () => {
    repository.findPasswordHash.mockResolvedValue('stored-hash');
    passwordService.compare.mockResolvedValue(true);

    await expect(service.isPasswordValid(USER_ID, 'Secret123')).resolves.toBe(true);
    expect(passwordService.compare).toHaveBeenCalledWith('Secret123', 'stored-hash');
  });

  it('changes the email to a normalized, verified one', async () => {
    await service.changeEmail(USER_ID, 'New@Example.com');

    expect(repository.update).toHaveBeenCalledWith(USER_ID, {
      email: 'new@example.com',
      isEmailVerified: true,
      emailVerifiedAt: new Date('2026-10-08T12:00:00Z'),
    });
  });
});
