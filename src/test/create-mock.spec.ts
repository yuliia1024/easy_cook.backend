import { createMock } from './create-mock';
import { createPrismaMock } from './prisma-mock';

describe('createMock', () => {
  interface Service {
    run(): number;
    value: number;
  }

  it('creates a jest.fn per method on first access', () => {
    const mock = createMock<Service>();
    mock.run.mockReturnValue(3);

    expect(mock.run()).toBe(3);
    expect(mock.run).toBe(mock.run);
  });

  it('keeps given props and is not a thenable', async () => {
    const mock = createMock<Service>({ value: 7 });

    expect(mock.value).toBe(7);
    await expect(Promise.resolve(mock)).resolves.toBe(mock);
  });
});

describe('createPrismaMock', () => {
  it('auto-mocks model delegates', async () => {
    const prisma = createPrismaMock();
    prisma.foodItem.count.mockResolvedValue(2);

    await expect(prisma.foodItem.count()).resolves.toBe(2);
    expect(prisma.foodItem).toBe(prisma.foodItem);
  });

  it('runs an interactive transaction against itself', async () => {
    const prisma = createPrismaMock();

    await expect(prisma.$transaction(async (tx) => tx === prisma)).resolves.toBe(true);
  });

  it('awaits a batch transaction', async () => {
    const prisma = createPrismaMock();

    await expect(
      prisma.$transaction([Promise.resolve(1), Promise.resolve(2)] as never),
    ).resolves.toEqual([1, 2]);
  });
});
