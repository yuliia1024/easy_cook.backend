import request from 'supertest';
import { createMenuWorld } from './menu-fixtures';
import { readStream } from './menu-stream';
import { createTestApp, FAKE_OPEN_AI_DELTAS, resetDatabase, TestApp } from './test-app';

describe('/api/conversations (e2e)', () => {
  let ctx: TestApp;
  const http = () => request(ctx.app.getHttpServer());
  const start = async (body: object = {}): Promise<string> =>
    (await http().post('/api/conversations').send(body).expect(201)).body.id;
  const say = (id: string, content: string) =>
    readStream(http().post(`/api/conversations/${id}/messages`).send({ content }).expect(201));

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('streams the reply, saves both messages and titles the conversation', async () => {
    await createMenuWorld(ctx);
    const id = await start();

    const { chunks } = await say(id, 'Hello there');

    expect(chunks.filter((chunk) => chunk.type === 'text-delta').map((c) => c.delta)).toEqual(
      FAKE_OPEN_AI_DELTAS,
    );
    expect(chunks.at(-1)).toMatchObject({ type: 'finish' });
    const { body } = await http().get(`/api/conversations/${id}`).expect(200);
    expect(body.title).toBe('Hello there');
    expect(body.messages).toEqual([
      expect.objectContaining({ role: 'user', content: 'Hello there' }),
      expect.objectContaining({ role: 'assistant', content: FAKE_OPEN_AI_DELTAS.join('') }),
    ]);
  });

  it('lists, renames, links and deletes conversations', async () => {
    const world = await createMenuWorld(ctx);
    const older = await start({ title: 'Older' });
    const newer = await start({ title: 'Newer' });
    await say(older, 'hi');

    const list = await http().get('/api/conversations').expect(200);
    expect(list.body.map((c: { title: string }) => c.title)).toEqual(['Older', 'Newer']);
    expect(list.body[0].messageCount).toBe(2);

    const menu = await http()
      .post('/api/menus')
      .send({
        title: 'Week',
        days: [
          {
            dayIndex: 0,
            meals: [{ mealType: 'lunch', recipeId: world.recipe.chicken, servings: 1 }],
          },
        ],
      })
      .expect(201);
    const linked = await http()
      .patch(`/api/conversations/${newer}`)
      .send({ title: 'About the menu', menuId: menu.body.id })
      .expect(200);
    expect(linked.body).toMatchObject({ title: 'About the menu', menuId: menu.body.id });

    await http().delete(`/api/menus/${menu.body.id}`).expect(204);
    const unlinked = await http().get(`/api/conversations/${newer}`).expect(200);
    expect(unlinked.body.menuId).toBeNull();

    await http().delete(`/api/conversations/${older}`).expect(204);
    await http().get(`/api/conversations/${older}`).expect(404);
    expect(await ctx.prisma.message.count()).toBe(0);
  });

  it('validates input and ownership', async () => {
    await createMenuWorld(ctx);
    const id = await start();

    await http().post(`/api/conversations/${id}/messages`).send({ content: '  ' }).expect(400);
    await http()
      .post('/api/conversations')
      .send({ menuId: '2b1e7f3a-5d47-4a8e-9f6c-1d2e3f4a5b6c' })
      .expect(404);
    await http()
      .post('/api/conversations/2b1e7f3a-5d47-4a8e-9f6c-1d2e3f4a5b6c/messages')
      .send({ content: 'hi' })
      .expect(404);
  });

  it('needs a profile', async () => {
    await http().get('/api/conversations').expect(404);
  });
});
