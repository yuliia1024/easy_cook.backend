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

  it('answers unknown routes with the error shape', async () => {
    const { body } = await request(ctx.app.getHttpServer()).get('/api/nope').expect(404);

    expect(body).toMatchObject({ statusCode: 404, path: '/api/nope' });
  });
});
