import request from 'supertest';
import { createTestApp, TestApp } from './test-app';

describe('GET /api/health (e2e)', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('reports the database as up', async () => {
    await request(ctx.app.getHttpServer())
      .get('/api/health')
      .expect(200, { status: 'ok', database: 'up' });
  });

  it('echoes the caller request id', async () => {
    await request(ctx.app.getHttpServer())
      .get('/api/health')
      .set('x-request-id', 'trace-me')
      .expect('x-request-id', 'trace-me');
  });

  it('generates a request id when the caller sent none', async () => {
    const { headers } = await request(ctx.app.getHttpServer()).get('/api/nope').expect(404);

    expect(headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('answers unknown routes with the error shape', async () => {
    const { body } = await request(ctx.app.getHttpServer()).get('/api/nope').expect(404);

    expect(body).toMatchObject({ statusCode: 404, path: '/api/nope' });
  });
});
