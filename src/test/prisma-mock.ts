import { PrismaService } from '../providers/prisma/prisma.service';
import { createMock } from './create-mock';

type DelegateKeys = {
  [K in keyof PrismaService]: K extends `$${string}`
    ? never
    : PrismaService[K] extends object
      ? K
      : never;
}[keyof PrismaService];

/**
 * Every model delegate method (`prisma.recipe.findMany`, ...) and `$` method is a `jest.Mock`.
 * Typed loosely on purpose: `jest.Mocked` over Prisma's generated types is too deep for tsc.
 */
export type PrismaMock = PrismaService & {
  [K in DelegateKeys]: { [M in keyof PrismaService[K]]: jest.Mock };
} & {
  $transaction: jest.Mock;
  $queryRaw: jest.Mock;
};

/**
 * A `OpenAiService` stand-in for repository specs. Model delegates are auto-mocked objects,
 * `$transaction(fn)` runs `fn` with the same mock, so a spec asserts on one set of calls.
 */
export function createPrismaMock(): PrismaMock {
  const delegates: Record<string, unknown> = {};
  const mock = createMock<PrismaService>();

  const prisma = new Proxy(mock, {
    get(obj, prop): unknown {
      if (typeof prop === 'string' && !prop.startsWith('$') && prop !== 'then') {
        delegates[prop] ??= createMock();
        return delegates[prop];
      }
      return obj[prop as keyof typeof obj];
    },
  }) as unknown as PrismaMock;

  prisma.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === 'function' ? arg(prisma) : Promise.all(arg as unknown[]),
  );

  return prisma;
}
