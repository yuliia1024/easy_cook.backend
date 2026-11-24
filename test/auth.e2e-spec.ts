import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  cookieHeader,
  cookiesOf,
  createTestApp,
  E2E_USER_EMAIL,
  fakeGoogleIdToken,
  httpAs,
  resetDatabase,
  resetRateLimits,
  signIn,
  TestApp,
} from './test-app';

const NEW_EMAIL = 'new@easy-cook.test';
const SESSION_COOKIE = '__Host-ec_session';
const NONCE_COOKIE = '__Host-ec_login_nonce';

describe('auth (e2e)', () => {
  let ctx: TestApp;
  const anonymous = () => request(ctx.app.getHttpServer());
  const profile = {
    age: 30,
    heightCm: 170,
    weightKg: 65,
    sex: 'female',
    activityLevel: 'moderate',
    goal: 'maintain',
  };

  /** A nonce and its cookie, as the login page gets them. */
  const startSignIn = async (): Promise<{ nonce: string; cookie: string }> => {
    const response = await anonymous().get('/api/auth/nonce').expect(200);
    return {
      nonce: response.body.nonce,
      cookie: cookieHeader(cookiesOf(response.headers['set-cookie'])),
    };
  };

  beforeAll(async () => {
    process.env.AUTH_COOKIE_SECURE = 'true';
    process.env.AUTH_ALLOWED_EMAILS = NEW_EMAIL;
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    await ctx.prisma.user.deleteMany({ where: { email: { not: E2E_USER_EMAIL } } });
    await resetRateLimits();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('sessions', () => {
    it('refuses every route without a session, except health and the sign-in', async () => {
      await anonymous().get('/api/profile').expect(401);
      await anonymous().get('/api/conversations').expect(401);
      await anonymous().get('/api/auth/session').expect(401);
      await anonymous().get('/api/health').expect(200);
      await anonymous().get('/api/auth/nonce').expect(200);
    });

    it('refuses a forged or unknown session cookie', async () => {
      await anonymous()
        .get('/api/profile')
        .set('Cookie', `${SESSION_COOKIE}=${'a'.repeat(43)}`)
        .expect(401);
      await anonymous().get('/api/profile').set('Cookie', `${SESSION_COOKIE}=nope`).expect(401);
    });

    it('gives the signed-in user and a CSRF token, never the session token', async () => {
      const { body, headers } = await ctx.http().get('/api/auth/session').expect(200);

      expect(body).toEqual({
        user: { id: ctx.session.userId, email: E2E_USER_EMAIL, name: 'E2E Cook', avatarUrl: null },
        csrfToken: ctx.session.csrfToken,
      });
      expect(headers['cache-control']).toBe('no-store');
    });

    it('keeps the data of each user apart', async () => {
      await ctx.http().put('/api/profile').send(profile).expect(200);
      const other = httpAs(ctx.app, await signIn(ctx.app, { email: NEW_EMAIL }));

      await other.get('/api/profile').expect(404);
      await other
        .put('/api/profile')
        .send({ ...profile, age: 40 })
        .expect(200);

      expect((await ctx.http().get('/api/profile').expect(200)).body.age).toBe(30);
      expect(await ctx.prisma.userProfile.count()).toBe(2);
    });
  });

  describe('sign-in', () => {
    it('sets an httpOnly, Secure, SameSite=Strict, host-only session cookie', async () => {
      const { nonce, cookie } = await startSignIn();
      const response = await anonymous()
        .post('/api/auth/google')
        .set('Cookie', cookie)
        .send({ idToken: fakeGoogleIdToken({ email: E2E_USER_EMAIL, nonce }) })
        .expect(200);

      const setCookie = (response.headers['set-cookie'] as unknown as string[]).join('\n');
      const session = setCookie.split('\n').find((line) => line.startsWith(`${SESSION_COOKIE}=`))!;
      expect(session).toMatch(/HttpOnly/);
      expect(session).toMatch(/Secure/);
      expect(session).toMatch(/SameSite=Strict/);
      expect(session).toMatch(/Path=\//);
      expect(session).not.toMatch(/Domain=/i);
      expect(setCookie).toMatch(new RegExp(`${NONCE_COOKIE}=;`));
      expect(JSON.stringify(response.body)).not.toContain(cookiesOf(session)[SESSION_COOKIE]);
    });

    it('creates a user for an allowed email', async () => {
      const session = await signIn(ctx.app, { email: NEW_EMAIL, name: 'New Cook' });

      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
      expect(user).toMatchObject({ email: NEW_EMAIL, googleSub: `google-${NEW_EMAIL}` });
    });

    it('refuses an email without access, and an unverified one', async () => {
      for (const identity of [
        { email: 'stranger@example.com' },
        { email: NEW_EMAIL, emailVerified: false },
      ]) {
        await resetRateLimits();
        const { nonce, cookie } = await startSignIn();
        await anonymous()
          .post('/api/auth/google')
          .set('Cookie', cookie)
          .send({ idToken: fakeGoogleIdToken({ ...identity, nonce }) })
          .expect(403);
      }
      expect(await ctx.prisma.user.count({ where: { email: NEW_EMAIL } })).toBe(0);
    });

    it('accepts a nonce once (no replayed token), and only from its browser', async () => {
      const { nonce, cookie } = await startSignIn();
      const idToken = fakeGoogleIdToken({ email: E2E_USER_EMAIL, nonce });
      const other = await startSignIn();

      await anonymous()
        .post('/api/auth/google')
        .set('Cookie', other.cookie)
        .send({ idToken })
        .expect(401);
      await resetRateLimits();
      await anonymous().post('/api/auth/google').send({ idToken }).expect(401);
      await resetRateLimits();
      await anonymous()
        .post('/api/auth/google')
        .set('Cookie', cookie)
        .send({ idToken })
        .expect(200);
      await resetRateLimits();
      await anonymous()
        .post('/api/auth/google')
        .set('Cookie', cookie)
        .send({ idToken })
        .expect(401);
    });

    it('ends the session the browser had (no fixation)', async () => {
      const first = await signIn(ctx.app, { email: NEW_EMAIL });
      await resetRateLimits();
      const { nonce, cookie } = await startSignIn();
      const response = await anonymous()
        .post('/api/auth/google')
        .set('Cookie', `${cookie}; ${first.cookie}`)
        .send({ idToken: fakeGoogleIdToken({ email: NEW_EMAIL, nonce }) })
        .expect(200);

      await httpAs(ctx.app, first).get('/api/auth/session').expect(401);
      expect(cookiesOf(response.headers['set-cookie'])[SESSION_COOKIE]).not.toBe(
        cookiesOf(first.cookie.split('; '))[SESSION_COOKIE],
      );
    });
  });

  describe('cross-site requests', () => {
    it('requires the CSRF token of the session on unsafe requests', async () => {
      const send = () => request(ctx.app.getHttpServer()).put('/api/profile').send(profile);

      await send().set('Cookie', ctx.session.cookie).expect(403);
      await send().set('Cookie', ctx.session.cookie).set('x-csrf-token', 'forged').expect(403);
      const other = await signIn(ctx.app, { email: NEW_EMAIL });
      await send()
        .set('Cookie', ctx.session.cookie)
        .set('x-csrf-token', other.csrfToken)
        .expect(403);
      await ctx.http().put('/api/profile').send(profile).expect(200);
    });

    it('refuses an unsafe request from another origin, even with the session', async () => {
      await ctx
        .http()
        .put('/api/profile')
        .set('Origin', 'https://evil.example.com')
        .send(profile)
        .expect(403);
      await ctx
        .http()
        .put('/api/profile')
        .set('Sec-Fetch-Site', 'cross-site')
        .send(profile)
        .expect(403);
      await ctx
        .http()
        .put('/api/profile')
        .set('Origin', 'http://localhost:5173')
        .send(profile)
        .expect(200);
    });

    it('refuses a body that is not JSON (415)', async () => {
      await ctx.http().put('/api/profile').type('form').send('age=30').expect(415);
    });

    it('answers a CORS preflight only for an allowed origin', async () => {
      const preflight = (origin: string) =>
        anonymous()
          .options('/api/profile')
          .set('Origin', origin)
          .set('Access-Control-Request-Method', 'PUT');

      const allowed = await preflight('http://localhost:5173');
      const evil = await preflight('https://evil.example.com');

      expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(allowed.headers['access-control-allow-credentials']).toBe('true');
      expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('sign-out', () => {
    it('ends the session and clears its cookie', async () => {
      const session = await signIn(ctx.app, { email: NEW_EMAIL });
      const http = httpAs(ctx.app, session);

      const response = await http.post('/api/auth/logout').expect(204);

      expect(String(response.headers['set-cookie'])).toMatch(new RegExp(`${SESSION_COOKIE}=;`));
      await http.get('/api/auth/session').expect(401);
      await ctx.http().get('/api/auth/session').expect(200);
    });

    it('ends the sessions of a deleted user', async () => {
      const session = await signIn(ctx.app, { email: NEW_EMAIL });
      await ctx.prisma.user.delete({ where: { id: session.userId } });

      await httpAs(ctx.app, session).get('/api/auth/session').expect(401);
    });
  });

  describe('rate limits', () => {
    const failSignIn = async (): Promise<void> => {
      const { nonce, cookie } = await startSignIn();
      await anonymous()
        .post('/api/auth/google')
        .set('Cookie', cookie)
        .send({ idToken: fakeGoogleIdToken({ email: 'stranger@example.com', nonce }) })
        .expect(403);
    };

    it('counts failed sign-ins only: 3 per 15 minutes, then blocks the ip for 30 minutes', async () => {
      await signIn(ctx.app, { email: NEW_EMAIL });
      await signIn(ctx.app, { email: NEW_EMAIL });
      for (let i = 0; i < 3; i += 1) {
        await failSignIn();
      }
      const { nonce, cookie } = await startSignIn();

      const blocked = await anonymous()
        .post('/api/auth/google')
        .set('Cookie', cookie)
        .send({ idToken: fakeGoogleIdToken({ email: NEW_EMAIL, nonce }) })
        .expect(429);

      expect(Number(blocked.headers['retry-after-sign_in'])).toBe(1800);
    });

    it('forgets the failed sign-ins of a client once it signs in', async () => {
      await failSignIn();
      await failSignIn();
      await signIn(ctx.app, { email: NEW_EMAIL });

      for (let i = 0; i < 3; i += 1) {
        await failSignIn();
      }
    });

    it('allows 5 chat messages a minute per user, then blocks for 5 minutes', async () => {
      const path = `/api/conversations/${randomUUID()}/messages`;
      for (let i = 0; i < 5; i += 1) {
        await ctx.http().post(path).send({ content: 'hi' }).expect(404);
      }

      const blocked = await ctx.http().post(path).send({ content: 'hi' }).expect(429);

      expect(Number(blocked.headers['retry-after-llm'])).toBe(300);
      await ctx.http().get('/api/auth/session').expect(200);
    });

    it('counts a signed-in user by account, not by ip', async () => {
      const path = `/api/conversations/${randomUUID()}/messages`;
      for (let i = 0; i < 5; i += 1) {
        await ctx.http().post(path).send({ content: 'hi' }).expect(404);
      }
      const other = httpAs(ctx.app, await signIn(ctx.app, { email: NEW_EMAIL }));

      await other.post(path).send({ content: 'hi' }).expect(404);
    });
  });
});
