import { EntityManager, Repository } from 'typeorm';
import { createMock } from '../../../test/create-mock';
import { buildUser, USER_ID } from '../../../test/fixtures';
import { User } from './user.entity';
import { UserRepository } from './user.repository';

describe('UserRepository', () => {
  let repository: jest.Mocked<Repository<User>>;
  let qb: Record<string, jest.Mock>;
  let userRepository: UserRepository;

  beforeEach(() => {
    qb = {
      addSelect: jest.fn(),
      leftJoinAndSelect: jest.fn(),
      select: jest.fn(),
      where: jest.fn(),
      getOne: jest.fn(),
    };
    for (const fn of ['addSelect', 'leftJoinAndSelect', 'select', 'where']) {
      qb[fn].mockReturnValue(qb);
    }
    repository = createMock<Repository<User>>();
    repository.createQueryBuilder.mockReturnValue(qb as never);
    userRepository = new UserRepository(repository);
  });

  describe('create', () => {
    it('creates and saves the entity', async () => {
      const user = buildUser();
      repository.create.mockReturnValue(user);
      repository.save.mockResolvedValue(user);

      await expect(userRepository.create({ email: user.email })).resolves.toBe(user);
      expect(repository.create).toHaveBeenCalledWith({ email: user.email });
      expect(repository.save).toHaveBeenCalledWith(user);
    });

    it('uses the transaction manager when given', async () => {
      const txRepository = createMock<Repository<User>>();
      const manager = createMock<EntityManager>();
      manager.getRepository.mockReturnValue(txRepository as never);

      await userRepository.create({ email: 'a@b.c' }, manager);

      expect(manager.getRepository).toHaveBeenCalledWith(User);
      expect(txRepository.save).toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    });
  });

  it('finds by id together with the profile', async () => {
    const user = buildUser();
    repository.findOne.mockResolvedValue(user);

    await expect(userRepository.findById(USER_ID)).resolves.toBe(user);
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { id: USER_ID },
      relations: { profile: true },
    });
  });

  it('finds by email together with the profile', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(userRepository.findByEmail('a@b.c')).resolves.toBeNull();
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { email: 'a@b.c' },
      relations: { profile: true },
    });
  });

  it('selects the hidden password hash when asked to', async () => {
    const user = buildUser();
    qb.getOne.mockResolvedValue(user);

    await expect(userRepository.findByEmailWithPassword('a@b.c')).resolves.toBe(user);
    expect(qb.addSelect).toHaveBeenCalledWith('user.password');
    expect(qb.leftJoinAndSelect).toHaveBeenCalledWith('user.profile', 'profile');
    expect(qb.where).toHaveBeenCalledWith('user.email = :email', { email: 'a@b.c' });
  });

  describe('findPasswordHash', () => {
    it('returns the hash', async () => {
      qb.getOne.mockResolvedValue({ id: USER_ID, password: 'hash' });

      await expect(userRepository.findPasswordHash(USER_ID)).resolves.toBe('hash');
      expect(qb.select).toHaveBeenCalledWith(['user.id', 'user.password']);
    });

    it('returns null for an unknown user', async () => {
      qb.getOne.mockResolvedValue(null);

      await expect(userRepository.findPasswordHash(USER_ID)).resolves.toBeNull();
    });
  });

  it('checks whether an email exists', async () => {
    repository.existsBy.mockResolvedValue(true);

    await expect(userRepository.existsByEmail('a@b.c')).resolves.toBe(true);
    expect(repository.existsBy).toHaveBeenCalledWith({ email: 'a@b.c' });
  });

  it('updates by id', async () => {
    await userRepository.update(USER_ID, { isEmailVerified: true });

    expect(repository.update).toHaveBeenCalledWith({ id: USER_ID }, { isEmailVerified: true });
  });
});
