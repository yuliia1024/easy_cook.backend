import { createPrismaMock, PrismaMock } from '../../../test/prisma-mock';
import { UserRepository } from './user.repository';

describe('UserRepository', () => {
  let prisma: PrismaMock;
  let repository: UserRepository;
  const data = {
    email: 'cook@example.com',
    googleSub: '1234',
    name: 'Cook',
    avatarUrl: null,
    lastLoginAt: new Date('2026-11-23T10:00:00Z'),
  };

  beforeEach(() => {
    prisma = createPrismaMock();
    repository = new UserRepository(prisma);
  });

  it('finds by id, Google account and email', async () => {
    await repository.findById('u1');
    await repository.findByGoogleSub('1234');
    await repository.findByEmail('cook@example.com');

    expect(prisma.user.findUnique.mock.calls).toEqual([
      [{ where: { id: 'u1' } }],
      [{ where: { googleSub: '1234' } }],
      [{ where: { email: 'cook@example.com' } }],
    ]);
  });

  it('creates and updates', async () => {
    await repository.create(data);
    await repository.update('u1', { name: 'Chef' });

    expect(prisma.user.create).toHaveBeenCalledWith({ data });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { name: 'Chef' },
    });
  });
});
