import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { Prisma } from '../src/generated/prisma/client';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { Intent } from '../src/common/constants';
import { IntentResultSchema, MenuPlan, MenuRequest } from '../src/common/contracts';
import {
  AssistantInvalidOutputException,
  AssistantUnavailableException,
} from '../src/common/exceptions';
import { MenuPlanCandidates } from '../src/modules/services/menu/menu-plan';
import { OpenAiService } from '../src/providers/open-ai/open-ai.service';
import { PrismaService } from '../src/providers/prisma/prisma.service';

/** Text the fake OpenAI streams instead of calling the API. */
export const FAKE_OPEN_AI_DELTAS = ['Day 1: ', 'oatmeal'];

/**
 * What the fake model answers. `intent` is the classification: an intent, `'unavailable'` to fail
 * like a broken API or `'invalid'` like output that does not match the schema; it fails the menu
 * plan the same way; `request` is the menu request it restates and `menuRequest` its fields. `menuPlan` is the answer to any
 * other structured call, made from the candidates the planner sent (`fakeMenuPlan`). `structuredInputs` records what each structured call was given. Set them in
 * a test; `resetFakeOpenAi()` restores `general_chat` and no plan.
 */
export const fakeOpenAiState: {
  intent: Intent | 'unavailable' | 'invalid';
  request: string | null;
  menuRequest: MenuRequest | null;
  menuPlan: FakeMenuPlan | null;
  streamTextCalls: number;
  structuredInputs: unknown[];
} = {
  intent: Intent.GeneralChat,
  request: null,
  menuRequest: null,
  menuPlan: null,
  streamTextCalls: 0,
  structuredInputs: [],
};

type FakeMenuPlan = (recipes: MenuPlanCandidates) => MenuPlan;
type PlannedMeals = MenuPlan['days'][number]['meals'];

/**
 * A plan with the same meals on each of `days` days, the meals given by recipe name (the snack is
 * the `Oat snack` of `createMenuWorld` unless named): each becomes the short id the planner sent
 * for it, or stays the name when it sent none.
 */
export const fakeMenuPlan =
  (
    message: string,
    named: Omit<PlannedMeals, 'snack'> & { snack?: string },
    days = 1,
  ): FakeMenuPlan =>
  (recipes) => {
    const meals: PlannedMeals = { snack: 'Oat snack', ...named };
    const idOf = (mealType: keyof PlannedMeals): string =>
      recipes[mealType].find(({ name }) => name === meals[mealType])?.id ?? meals[mealType];
    const ids: PlannedMeals = {
      breakfast: idOf('breakfast'),
      lunch: idOf('lunch'),
      dinner: idOf('dinner'),
      snack: idOf('snack'),
    };
    return {
      message,
      days: Array.from({ length: days }, (_, dayIndex) => ({ dayIndex, meals: ids })),
    };
  };

export function resetFakeOpenAi(): void {
  fakeOpenAiState.intent = Intent.GeneralChat;
  fakeOpenAiState.request = null;
  fakeOpenAiState.menuRequest = null;
  fakeOpenAiState.menuPlan = null;
  fakeOpenAiState.streamTextCalls = 0;
  fakeOpenAiState.structuredInputs = [];
}

const fakeOpenAi: Pick<OpenAiService, 'streamText' | 'generateStructured'> = {
  async *streamText(): AsyncGenerator<string> {
    fakeOpenAiState.streamTextCalls += 1;
    yield* FAKE_OPEN_AI_DELTAS;
  },
  async generateStructured<T>(input: unknown, schema: unknown): Promise<T> {
    fakeOpenAiState.structuredInputs.push(input);
    if (fakeOpenAiState.intent === 'unavailable') {
      throw new AssistantUnavailableException(true);
    }
    if (fakeOpenAiState.intent === 'invalid') {
      throw new AssistantInvalidOutputException();
    }
    if (schema !== IntentResultSchema) {
      if (!fakeOpenAiState.menuPlan) {
        throw new AssistantInvalidOutputException();
      }
      const [sent] = input as Array<{ content: string }>;
      return fakeOpenAiState.menuPlan(JSON.parse(sent.content).recipes) as T;
    }
    return {
      intent: fakeOpenAiState.intent,
      request: fakeOpenAiState.request,
      menuRequest: fakeOpenAiState.menuRequest,
      target: null,
    } as T;
  },
};

export interface TestApp {
  app: INestApplication<App>;
  prisma: PrismaService;
}

/** The real app (same pipes, filter and prefix as `main.ts`) on the test database, with a fake OpenAI. */
export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(OpenAiService)
    .useValue(fakeOpenAi)
    .overrideProvider(ThrottlerStorage)
    .useValue(rateLimits)
    .compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({ logger: false });
  configureApp(app);
  await app.init();

  return { app, prisma: app.get(PrismaService) };
}

/** The in-memory rate limit storage, started afresh by `reset()`. */
class ResettableThrottlerStorage implements ThrottlerStorage {
  private storage = new ThrottlerStorageService();

  public async increment(
    ...args: Parameters<ThrottlerStorage['increment']>
  ): ReturnType<ThrottlerStorage['increment']> {
    return this.storage.increment(...args);
  }

  public reset(): void {
    this.storage.onApplicationShutdown();
    this.storage = new ThrottlerStorageService();
  }
}

const rateLimits = new ResettableThrottlerStorage();

/** Forgets the requests the rate limits counted, so every test starts with the full limits. */
export function resetRateLimits(): void {
  rateLimits.reset();
}

/** Empties every table except Prisma's migration log. */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length > 0) {
    const list = tables.map(({ tablename }) => `"public"."${tablename}"`).join(', ');
    await prisma.$executeRaw`TRUNCATE TABLE ${Prisma.raw(list)} CASCADE`;
  }
}
