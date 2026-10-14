import request from 'supertest';
import { createMenuWorld } from './menu-fixtures';
import { createTestApp, resetDatabase, TestApp } from './test-app';

describe('/api/conversations (e2e)', () => {
  let ctx: TestApp;
  const http = () => request(ctx.app.getHttpServer());
  const start = async (body: object = {}): Promise<string> =>
    (await http().post('/api/conversations').send(body).expect(201)).body.id;
  const say = (id: string, content: string) =>
    http().post(`/api/conversations/${id}/messages`).send({ content }).expect(201);

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('answers with the placeholder assistant and titles the conversation', async () => {
    await createMenuWorld(ctx);
    const id = await start();

    const { body } = await say(id, 'Hello there');

    expect(body.title).toBe('Hello there');
    expect(body.menuId).toBeNull();
    expect(body.messages).toEqual([
      expect.objectContaining({ role: 'user', content: 'Hello there', menuVersionId: null }),
      expect.objectContaining({
        role: 'assistant',
        content: expect.stringContaining('Your daily goal is 2172 kcal'),
        menuVersionId: null,
      }),
    ]);
  });

  it('plans a menu from the chat and links it', async () => {
    await createMenuWorld(ctx);
    const id = await start();

    const { body } = await say(id, 'Plan a menu for 2 days please');

    const reply = body.messages[1];
    expect(reply.content).toMatch(
      /^Planning a 2-day menu around 2172 kcal a day\.\n\n"Menu for 2 days" is ready as a draft: 2 days/,
    );
    expect(body.menuId).toEqual(expect.any(String));
    const menu = await http().get(`/api/menus/${body.menuId}`).expect(200);
    expect(reply.menuId).toBe(body.menuId);
    expect(menu.body.versions[0]).toMatchObject({ id: reply.menuVersionId, generatedBy: 'stub' });
  });

  it('explains why a menu could not be planned', async () => {
    await createMenuWorld(ctx, { goal: false });
    const id = await start();

    const { body } = await say(id, 'plan a menu');

    expect(body.messages[1].content).toBe(
      'Planning a 7-day menu.\n\nI could not plan the menu: No nutrition goal is set yet',
    );
    expect(body.menuId).toBeNull();
    expect(await ctx.prisma.menu.count()).toBe(0);
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
