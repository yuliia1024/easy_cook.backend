import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { Prisma } from '../src/generated/prisma/client';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { Intent, MealType } from '../src/common/constants';
import {
  IntentResultSchema,
  MenuDayPlanSchema,
  MenuMealPlanSchema,
  MenuPlan,
  MenuRequest,
  MenuTarget,
  SummaryResultSchema,
} from '../src/common/contracts';
import {
  AssistantInvalidOutputException,
  AssistantUnavailableException,
} from '../src/common/exceptions';
import { MenuPlanCandidates } from '../src/modules/services/menu/menu-plan';
import {
  ModelResult,
  OpenAiService,
  ToolLoopOptions,
} from '../src/providers/open-ai/open-ai.service';
import { PrismaService } from '../src/providers/prisma/prisma.service';

/** Text the fake OpenAI streams instead of calling the API. */
export const FAKE_OPEN_AI_DELTAS = ['Day 1: ', 'oatmeal'];
export const FAKE_SUMMARY = 'The user rejected the salmon soup.';

/**
 * What the fake model answers. `intent` is the classification: an intent, `'unavailable'` to fail
 * like a broken API or `'invalid'` like output that does not match the schema; it fails the menu
 * plan the same way; `request` is the menu request it restates, `menuRequest` its fields and `targets` the parts of
 * the menu a revision changes. `menuPlan` is the answer to any other structured call, made from the candidates the planner
 * sent (`fakeMenuPlan`), its first day for every day planned again and the meal of that day for every
 * meal replaced; `summary` is
 * the summary of the older messages. `structuredInputs` records what each structured call was given. Set them in
 * a test; `resetFakeOpenAi()` restores `general_chat` and no plan.
 */
export const fakeOpenAiState: {
  intent: Intent | 'unavailable' | 'invalid';
  request: string | null;
  menuRequest: MenuRequest | null;
  targets: MenuTarget[] | null;
  menuPlan: FakeMenuPlan | null;
  summary: string;
  streamTextCalls: number;
  structuredInputs: unknown[];
  toolCalls: FakeToolCall[];
  toolResults: unknown[];
} = {
  intent: Intent.GeneralChat,
  request: null,
  menuRequest: null,
  targets: null,
  menuPlan: null,
  summary: FAKE_SUMMARY,
  streamTextCalls: 0,
  structuredInputs: [],
  toolCalls: [],
  toolResults: [],
};

/**
 * A tool the fake chat model calls, one per step; `input` can read the results of the calls before
 * it (`fakeOpenAiState.toolResults`), as the model reads them.
 */
export interface FakeToolCall {
  toolName: string;
  input: unknown | ((results: unknown[]) => unknown);
}

export type FakeMenuPlan = (recipes: MenuPlanCandidates) => MenuPlan;
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
  fakeOpenAiState.targets = null;
  fakeOpenAiState.menuPlan = null;
  fakeOpenAiState.summary = FAKE_SUMMARY;
  fakeOpenAiState.streamTextCalls = 0;
  fakeOpenAiState.structuredInputs = [];
  fakeOpenAiState.toolCalls = [];
  fakeOpenAiState.toolResults = [];
}

async function fakeStructured<T>(input: unknown, schema: unknown): Promise<T> {
  fakeOpenAiState.structuredInputs.push(input);
  if (schema === SummaryResultSchema) {
    return { summary: fakeOpenAiState.summary } as T;
  }
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
    const { recipes, mealType } = JSON.parse(sent.content);
    if (schema === MenuMealPlanSchema) {
      const plan = fakeOpenAiState.menuPlan({
        breakfast: [],
        lunch: [],
        snack: [],
        dinner: [],
        [mealType]: recipes,
      });
      return { message: plan.message, recipe: plan.days[0].meals[mealType as MealType] } as T;
    }
    const plan = fakeOpenAiState.menuPlan(recipes);
    return (
      schema === MenuDayPlanSchema ? { message: plan.message, meals: plan.days[0].meals } : plan
    ) as T;
  }
  return {
    intent: fakeOpenAiState.intent,
    request: fakeOpenAiState.request,
    menuRequest: fakeOpenAiState.menuRequest,
    targets: fakeOpenAiState.targets,
  } as T;
}

/** The model id the fake answers with. */
export const FAKE_MODEL_ID = 'gpt-fake';

const fakeOpenAi: Pick<
  OpenAiService,
  'streamText' | 'streamWithTools' | 'generateStructured' | 'generateStructuredResult'
> = {
  async *streamText(): AsyncGenerator<string> {
    fakeOpenAiState.streamTextCalls += 1;
    yield* FAKE_OPEN_AI_DELTAS;
  },
  /**
   * Runs the real tools of `fakeOpenAiState.toolCalls`, one per step, as the AI SDK loop does: up to
   * `maxSteps - 1` of them, the last step answering with `FAKE_OPEN_AI_DELTAS`, and none once
   * `isDone`; an unknown tool is an error result, as the SDK gives the model.
   */
  async *streamWithTools(_input: unknown, options: ToolLoopOptions): AsyncGenerator<string> {
    fakeOpenAiState.streamTextCalls += 1;
    const results = fakeOpenAiState.toolResults;
    for (const [step, call] of fakeOpenAiState.toolCalls.entries()) {
      if (step >= options.maxSteps - 1 || options.isDone?.()) {
        break;
      }
      const args = typeof call.input === 'function' ? call.input(results) : call.input;
      const tool = options.tools[call.toolName];
      results.push(
        tool
          ? await tool.execute!(args, {
              toolCallId: `call_${step}`,
              messages: [],
              context: undefined,
              abortSignal: options.abortSignal,
            })
          : { error: `Model tried to call unavailable tool '${call.toolName}'.` },
      );
    }
    if (!options.isDone?.()) {
      yield* FAKE_OPEN_AI_DELTAS;
    }
  },
  generateStructured: fakeStructured,
  async generateStructuredResult<T>(input: unknown, schema: unknown): Promise<ModelResult<T>> {
    return {
      output: await fakeStructured<T>(input, schema),
      modelId: FAKE_MODEL_ID,
      latencyMs: 0,
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
    };
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
