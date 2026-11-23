import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../src/generated/prisma/client';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import {
  CSRF_HEADER,
  Intent,
  MealType,
  RATE_LIMIT_REDIS_KEY,
  WishOfferAnswer,
} from '../src/common/constants';
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
  InvalidGoogleTokenUnauthorizedException,
} from '../src/common/exceptions';
import { runWithRequestId, setCurrentUserId } from '../src/common/logger';
import { GoogleIdentity } from '../src/common/types';
import { GoogleIdentityService } from '../src/providers/google/google-identity.service';
import { RedisService } from '../src/providers/redis/redis.service';
import { MenuPlanCandidates } from '../src/modules/services/menu/menu-plan';
import { ModelResult, LlmService, ToolLoopOptions } from '../src/providers/llm/llm.service';
import { EmbeddingService } from '../src/providers/embedding/embedding.service';
import { PrismaService } from '../src/providers/prisma/prisma.service';
import { createFakeEmbeddingService } from '../src/test/fake-embeddings';

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
 * a test; `resetFakeLlm()` restores `general_chat` and no plan.
 */
export const fakeLlmState: {
  intent: Intent | 'unavailable' | 'invalid';
  request: string | null;
  menuRequest: MenuRequest | null;
  targets: MenuTarget[] | null;
  wishOffer: WishOfferAnswer | null;
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
  wishOffer: null,
  menuPlan: null,
  summary: FAKE_SUMMARY,
  streamTextCalls: 0,
  structuredInputs: [],
  toolCalls: [],
  toolResults: [],
};

/**
 * A tool the fake chat model calls, one per step; `input` can read the results of the calls before
 * it (`fakeLlmState.toolResults`), as the model reads them.
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

export function resetFakeLlm(): void {
  fakeLlmState.intent = Intent.GeneralChat;
  fakeLlmState.request = null;
  fakeLlmState.menuRequest = null;
  fakeLlmState.targets = null;
  fakeLlmState.wishOffer = null;
  fakeLlmState.menuPlan = null;
  fakeLlmState.summary = FAKE_SUMMARY;
  fakeLlmState.streamTextCalls = 0;
  fakeLlmState.structuredInputs = [];
  fakeLlmState.toolCalls = [];
  fakeLlmState.toolResults = [];
}

async function fakeStructured<T>(input: unknown, schema: unknown): Promise<T> {
  fakeLlmState.structuredInputs.push(input);
  if (schema === SummaryResultSchema) {
    return { summary: fakeLlmState.summary } as T;
  }
  if (fakeLlmState.intent === 'unavailable') {
    throw new AssistantUnavailableException(true);
  }
  if (fakeLlmState.intent === 'invalid') {
    throw new AssistantInvalidOutputException();
  }
  if (schema !== IntentResultSchema) {
    if (!fakeLlmState.menuPlan) {
      throw new AssistantInvalidOutputException();
    }
    const [sent] = input as Array<{ content: string }>;
    const { recipes, mealType } = JSON.parse(sent.content);
    if (schema === MenuMealPlanSchema) {
      const plan = fakeLlmState.menuPlan({
        breakfast: [],
        lunch: [],
        snack: [],
        dinner: [],
        [mealType]: recipes,
      });
      return { message: plan.message, recipe: plan.days[0].meals[mealType as MealType] } as T;
    }
    const plan = fakeLlmState.menuPlan(recipes);
    return (
      schema === MenuDayPlanSchema ? { message: plan.message, meals: plan.days[0].meals } : plan
    ) as T;
  }
  return {
    intent: fakeLlmState.intent,
    request: fakeLlmState.request,
    menuRequest: fakeLlmState.menuRequest,
    targets: fakeLlmState.targets,
    wishOffer: fakeLlmState.wishOffer,
  } as T;
}

/** The model id the fake answers with. */
export const FAKE_MODEL_ID = 'gpt-fake';

const fakeLlm: Pick<
  LlmService,
  'streamText' | 'streamWithTools' | 'generateStructured' | 'generateStructuredResult'
> = {
  async *streamText(): AsyncGenerator<string> {
    fakeLlmState.streamTextCalls += 1;
    yield* FAKE_OPEN_AI_DELTAS;
  },
  /**
   * Runs the real tools of `fakeLlmState.toolCalls`, one per step, as the AI SDK loop does: up to
   * `maxSteps - 1` of them, the last step answering with `FAKE_OPEN_AI_DELTAS`, and none once
   * `isDone`; an unknown tool is an error result, as the SDK gives the model.
   */
  async *streamWithTools(_input: unknown, options: ToolLoopOptions): AsyncGenerator<string> {
    fakeLlmState.streamTextCalls += 1;
    const results = fakeLlmState.toolResults;
    for (const [step, call] of fakeLlmState.toolCalls.entries()) {
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

/** A signed-in browser: its cookies and the CSRF token of its session. */
export interface TestSession {
  userId: string;
  cookie: string;
  csrfToken: string;
}

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';
export type TestHttp = Pick<TestAgent, HttpMethod>;

export interface TestApp {
  app: INestApplication<App>;
  prisma: PrismaService;
  /** The user `createTestApp` signed in; kept by `resetDatabase`. */
  session: TestSession;
  /** Requests of that user: its session cookie and CSRF token on every call. */
  http: () => TestHttp;
  /** Runs `callback` as a request of that user (services that read the current user). */
  asUser: <T>(callback: () => T) => T;
}

/** The user every e2e test runs as unless it signs in another one. */
export const E2E_USER_EMAIL = 'e2e@easy-cook.test';

const part = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');

/**
 * A stand-in Google ID token (JWT-shaped) the fake `GoogleIdentityService` accepts: it carries the
 * identity as its payload. No real Google key signs it; the real verifier would refuse it.
 */
export function fakeGoogleIdToken(identity: Partial<GoogleIdentity> & { email: string }): string {
  const claims: GoogleIdentity = {
    sub: `google-${identity.email}`,
    emailVerified: true,
    name: 'E2E Cook',
    avatarUrl: null,
    nonce: null,
    ...identity,
  };
  return [part({ alg: 'none' }), part(claims), 'fake-signature'].join('.');
}

const fakeGoogleIdentity: Pick<GoogleIdentityService, 'verify'> = {
  async verify(idToken: string): Promise<GoogleIdentity> {
    try {
      return JSON.parse(
        Buffer.from(idToken.split('.')[1], 'base64url').toString(),
      ) as GoogleIdentity;
    } catch {
      throw new InvalidGoogleTokenUnauthorizedException();
    }
  },
};

/** `name=value` of each `Set-Cookie` header, ready for a `Cookie` header. */
export function cookiesOf(setCookie: string | string[] | undefined): Record<string, string> {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return Object.fromEntries(
    headers.map((header) => header.split(';')[0].split('=') as [string, string]),
  );
}

export const cookieHeader = (cookies: Record<string, string>): string =>
  Object.entries(cookies)
    .filter(([, value]) => value !== '')
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

/**
 * Signs in like the web app: a nonce (and its cookie), a Google ID token carrying it, the session
 * cookie and CSRF token back. `identity.nonce` overrides the nonce the token carries.
 */
export async function signIn(
  app: INestApplication<App>,
  identity: Partial<GoogleIdentity> & { email: string },
): Promise<TestSession> {
  const server = app.getHttpServer();
  const nonceResponse = await request(server).get('/api/auth/nonce').expect(200);
  const nonceCookies = cookiesOf(nonceResponse.headers['set-cookie']);
  const response = await request(server)
    .post('/api/auth/google')
    .set('Cookie', cookieHeader(nonceCookies))
    .send({ idToken: fakeGoogleIdToken({ nonce: nonceResponse.body.nonce, ...identity }) })
    .expect(200);
  const sessionCookies = cookiesOf(response.headers['set-cookie']);
  return {
    userId: response.body.user.id,
    cookie: cookieHeader(sessionCookies),
    csrfToken: response.body.csrfToken,
  };
}

/** Requests that carry the cookie and CSRF token of `session`. */
export function httpAs(app: INestApplication<App>, session: TestSession): TestHttp {
  const server = request(app.getHttpServer());
  const as =
    (method: HttpMethod) =>
    (url: string): ReturnType<TestAgent[HttpMethod]> =>
      server[method](url).set('Cookie', session.cookie).set(CSRF_HEADER, session.csrfToken);
  return {
    get: as('get'),
    post: as('post'),
    put: as('put'),
    patch: as('patch'),
    delete: as('delete'),
  } as TestHttp;
}

/**
 * The real app (same pipes, filter and prefix as `main.ts`) on the test database, with a fake
 * OpenAI and fake embeddings (`search_recipes` never calls a real model).
 */
export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GoogleIdentityService)
    .useValue(fakeGoogleIdentity)
    .overrideProvider(LlmService)
    .useValue(fakeLlm)
    .overrideProvider(EmbeddingService)
    .useValue(createFakeEmbeddingService())
    .compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({ logger: false });
  configureApp(app);
  await app.init();

  const prisma = app.get(PrismaService);
  await prisma.user.upsert({
    where: { email: E2E_USER_EMAIL },
    create: { email: E2E_USER_EMAIL },
    update: {},
  });
  const session = await signIn(app, { email: E2E_USER_EMAIL });
  testRedis = app.get(RedisService);
  await resetRateLimits();

  return {
    app,
    prisma,
    session,
    http: () => httpAs(app, session),
    asUser: (callback) =>
      runWithRequestId('e2e', () => {
        setCurrentUserId(session.userId);
        return callback();
      }),
  };
}

/** The Redis of the running test app (`TEST_REDIS_URL`): the real rate limits count there. */
let testRedis: RedisService | undefined;

/** Forgets the requests the rate limits counted, so every test starts with the full limits. */
export async function resetRateLimits(): Promise<void> {
  const client = testRedis?.client;
  if (!client) {
    return;
  }
  const keys = await client.keys(RATE_LIMIT_REDIS_KEY('*'));
  if (keys.length > 0) {
    await client.del(...keys);
  }
}

/**
 * Empties every table except Prisma's migration log and the users (the signed-in test user stays,
 * with its session); `users: true` empties those too, ending every session.
 */
export async function resetDatabase(
  prisma: PrismaService,
  { users = false }: { users?: boolean } = {},
): Promise<void> {
  const kept = users ? ['_prisma_migrations'] : ['_prisma_migrations', 'users'];
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> ALL(${kept})`;
  if (tables.length > 0) {
    const list = tables.map(({ tablename }) => `"public"."${tablename}"`).join(', ');
    await prisma.$executeRaw`TRUNCATE TABLE ${Prisma.raw(list)} CASCADE`;
  }
}
