import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../src/generated/prisma/client';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { Intent } from '../src/common/constants';
import { IntentResultSchema, MenuPlan } from '../src/common/contracts';
import {
  AssistantInvalidOutputException,
  AssistantUnavailableException,
} from '../src/common/exceptions';
import { OpenAiService } from '../src/providers/open-ai/open-ai.service';
import { PrismaService } from '../src/providers/prisma/prisma.service';

/** Text the fake OpenAI streams instead of calling the API. */
export const FAKE_OPEN_AI_DELTAS = ['Day 1: ', 'oatmeal'];

/**
 * What the fake model answers. `intent` is the classification: an intent, `'unavailable'` to fail
 * like a broken API or `'invalid'` like output that does not match the schema; it fails the menu
 * plan the same way. `menuPlan` is the answer to any other structured call. Set them in a test;
 * `resetFakeOpenAi()` restores `general_chat` and no plan.
 */
export const fakeOpenAiState: {
  intent: Intent | 'unavailable' | 'invalid';
  menuPlan: MenuPlan | null;
  streamTextCalls: number;
} = {
  intent: Intent.GeneralChat,
  menuPlan: null,
  streamTextCalls: 0,
};

export function resetFakeOpenAi(): void {
  fakeOpenAiState.intent = Intent.GeneralChat;
  fakeOpenAiState.menuPlan = null;
  fakeOpenAiState.streamTextCalls = 0;
}

const fakeOpenAi: Pick<OpenAiService, 'streamText' | 'generateStructured'> = {
  async *streamText(): AsyncGenerator<string> {
    fakeOpenAiState.streamTextCalls += 1;
    yield* FAKE_OPEN_AI_DELTAS;
  },
  async generateStructured<T>(_input: unknown, schema: unknown): Promise<T> {
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
      return fakeOpenAiState.menuPlan as T;
    }
    return { intent: fakeOpenAiState.intent } as T;
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
    .compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({ logger: false });
  configureApp(app);
  await app.init();

  return { app, prisma: app.get(PrismaService) };
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
