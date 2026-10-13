import { createPrismaClient } from './prisma';

describe('createPrismaClient', () => {
  it('builds a client for the given url without connecting', async () => {
    const client = createPrismaClient('postgresql://u:p@localhost:1/d');

    expect(typeof client.foodItem.findMany).toBe('function');
    await client.$disconnect();
  });

  it('requires a url', () => {
    expect(() => createPrismaClient('')).toThrow('DATABASE_URL is not set');
  });
});
