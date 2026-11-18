import request from 'supertest';
import {
  ChatToolErrorCode,
  ChatToolName,
  Intent,
  PreferenceChangeAction,
  PreferenceChangeStatus,
  PreferenceType,
} from '../src/common/constants';
import { createMenuWorld } from './menu-fixtures';
import { readStream, StreamChunk } from './menu-stream';
import {
  createTestApp,
  FAKE_OPEN_AI_DELTAS,
  fakeOpenAiState,
  resetDatabase,
  resetFakeOpenAi,
  resetRateLimits,
  TestApp,
} from './test-app';

/** What the model gets for `apply_preference_change` while no change waits: the tool is not given. */
const UNAVAILABLE_APPLY = `Model tried to call unavailable tool '${ChatToolName.ApplyPreferenceChange}'.`;

/**
 * A change of the dietary preferences the chat model proposes (`propose_preference_change`) is
 * written only once the user confirms it: a yes in the chat (`apply_preference_change`) or the
 * confirm button (`POST /conversations/:id/preference-change/confirm`), with the same result.
 */
describe('preference changes (e2e)', () => {
  let ctx: TestApp;
  const http = () => request(ctx.app.getHttpServer());
  const start = async (): Promise<string> =>
    (await http().post('/api/conversations').send({}).expect(201)).body.id;
  const say = async (id: string, content: string): Promise<StreamChunk[]> =>
    (
      await readStream(
        http().post(`/api/conversations/${id}/messages`).send({ content }).expect(201),
      )
    ).chunks;
  const dataOf = (chunks: StreamChunk[], type: string): any =>
    chunks.find((chunk) => chunk.type === type)?.data;
  const preferences = async (): Promise<Array<{ preferenceType: string; value: string }>> =>
    (await http().get('/api/preferences').expect(200)).body.map(
      ({ preferenceType, value }: { preferenceType: string; value: string }) => ({
        preferenceType,
        value,
      }),
    );
  const peanut = {
    action: PreferenceChangeAction.Add,
    preferenceType: PreferenceType.Allergy,
    value: 'peanut',
  };
  /** The confirm button, sending the change the client shows. */
  const confirm = (id: string, change: object = peanut) =>
    http().post(`/api/conversations/${id}/preference-change/confirm`).send(change);
  /** The chat model answers the next message with these tools, one per step. */
  const modelCalls = (...calls: Array<[ChatToolName, object]>): void => {
    fakeOpenAiState.intent = Intent.GeneralChat;
    fakeOpenAiState.toolResults = [];
    fakeOpenAiState.toolCalls = calls.map(([toolName, input]) => ({ toolName, input }));
  };
  /** The model proposes `change` in a new conversation; returns its id. */
  const proposed = async (change: object = { ...peanut, value: ' Peanut ' }): Promise<string> => {
    const id = await start();
    modelCalls([ChatToolName.ProposePreferenceChange, change]);
    await say(id, "I'm allergic to peanuts");
    return id;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    resetFakeOpenAi();
    resetRateLimits();
    await createMenuWorld(ctx);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('writes nothing for a proposal: the reply keeps it and the stream shows it', async () => {
    const id = await start();
    modelCalls([ChatToolName.ProposePreferenceChange, { ...peanut, value: ' Peanut ' }]);

    const chunks = await say(id, "I'm allergic to peanuts");

    expect(fakeOpenAiState.toolResults).toEqual([
      { status: PreferenceChangeStatus.Proposed, change: peanut },
    ]);
    expect(dataOf(chunks, 'data-preference-change')).toEqual({ change: peanut });
    expect(await preferences()).toEqual([]);
    const { body } = await http().get(`/api/conversations/${id}`).expect(200);
    expect(body.messages[1]).toMatchObject({
      content: FAKE_OPEN_AI_DELTAS.join(''),
      preferenceChange: peanut,
    });
  });

  it('applies the proposal on a yes in the chat', async () => {
    const id = await proposed();
    modelCalls([ChatToolName.ApplyPreferenceChange, { ...peanut, value: 'shellfish' }]);

    const chunks = await say(id, 'Yes');

    expect(fakeOpenAiState.toolResults).toEqual([
      { status: PreferenceChangeStatus.Applied, change: peanut },
    ]);
    expect(dataOf(chunks, 'data-preferences-updated')).toEqual({ change: peanut });
    expect(
      chunks.filter(({ type }) => type === 'data-status').map(({ data }) => data.step),
    ).toEqual(['thinking', 'updating_preferences']);
    expect(await preferences()).toEqual([{ preferenceType: 'allergy', value: 'peanut' }]);
  });

  it('gives the same preferences by the confirm button', async () => {
    const byChat = await proposed();
    modelCalls([ChatToolName.ApplyPreferenceChange, {}]);
    await say(byChat, 'Yes');
    const afterChat = await preferences();
    await resetDatabase(ctx.prisma);
    await createMenuWorld(ctx);
    const byButton = await proposed();

    const { body } = await confirm(byButton).expect(200);

    expect(body).toEqual({ status: PreferenceChangeStatus.Applied, change: peanut });
    expect(await preferences()).toEqual(afterChat);
  });

  it('writes a confirmed change once, however often it is confirmed', async () => {
    const id = await proposed();
    await confirm(id).expect(200);

    const { body } = await confirm(id).expect(200);

    expect(body.status).toBe(PreferenceChangeStatus.AlreadyApplied);
    expect(await preferences()).toEqual([{ preferenceType: 'allergy', value: 'peanut' }]);
  });

  it('cannot propose and apply in one reply: nothing is written without the yes', async () => {
    const id = await start();
    modelCalls(
      [ChatToolName.ProposePreferenceChange, peanut],
      [ChatToolName.ApplyPreferenceChange, {}],
    );

    const chunks = await say(id, "I'm allergic to peanuts");

    expect(fakeOpenAiState.toolResults[1]).toEqual({ error: UNAVAILABLE_APPLY });
    expect(chunks.some(({ type }) => type === 'data-preferences-updated')).toBe(false);
    expect(await preferences()).toEqual([]);
  });

  it('ends a proposal with the next reply that proposes nothing', async () => {
    const id = await proposed();
    modelCalls();
    await say(id, 'What is a good breakfast?');

    await confirm(id).expect(404);
    modelCalls([ChatToolName.ApplyPreferenceChange, {}]);
    await say(id, 'Yes');

    expect(fakeOpenAiState.toolResults).toEqual([{ error: UNAVAILABLE_APPLY }]);
    expect(await preferences()).toEqual([]);
  });

  it('answers in text without a proposal, never a 500', async () => {
    const id = await start();
    await confirm(id).expect(404);
    modelCalls([ChatToolName.ApplyPreferenceChange, {}]);

    const chunks = await say(id, 'Yes');

    expect(chunks.some(({ type }) => type === 'error')).toBe(false);
    expect(chunks.at(-1)).toMatchObject({ type: 'finish' });
  });

  it('refuses to propose a change the preferences do not allow', async () => {
    const id = await start();
    modelCalls([
      ChatToolName.ProposePreferenceChange,
      { ...peanut, preferenceType: PreferenceType.Diet, value: 'carnivore' },
    ]);

    const chunks = await say(id, 'I eat only meat');

    expect(fakeOpenAiState.toolResults).toEqual([
      expect.objectContaining({ error: ChatToolErrorCode.Rejected }),
    ]);
    expect(dataOf(chunks, 'data-preference-change')).toBeUndefined();
    await confirm(id).expect(404);
  });

  it('removes a saved preference once the removal is confirmed', async () => {
    await http()
      .post('/api/preferences')
      .send({ preferenceType: 'diet', value: 'vegetarian' })
      .expect(201);
    const removal = {
      action: PreferenceChangeAction.Remove,
      preferenceType: PreferenceType.Diet,
      value: 'vegetarian',
    };
    const id = await proposed(removal);
    expect(await preferences()).toHaveLength(1);

    await confirm(id, removal).expect(200);

    expect(await preferences()).toEqual([]);
  });

  describe('removing an allergy', () => {
    const removal = { ...peanut, action: PreferenceChangeAction.Remove };

    beforeEach(async () => {
      await http().post('/api/preferences').send({ preferenceType: 'allergy', value: 'peanut' });
    });

    it('is not applied by a yes in the chat', async () => {
      const id = await proposed(removal);
      modelCalls([ChatToolName.ApplyPreferenceChange, {}]);

      await say(id, 'Yes');

      expect(fakeOpenAiState.toolResults).toEqual([
        {
          error: ChatToolErrorCode.Rejected,
          message: 'Removing an allergy is applied only with the confirm button of the proposal.',
        },
      ]);
      expect(await preferences()).toEqual([{ preferenceType: 'allergy', value: 'peanut' }]);
    });

    it('is applied by the confirm button', async () => {
      const id = await proposed(removal);

      await confirm(id, removal).expect(200);

      expect(await preferences()).toEqual([]);
    });
  });

  it('refuses to confirm another change than the pending one, e.g. of a failed reply', async () => {
    const id = await proposed();

    const { body } = await confirm(id, { ...peanut, value: 'shellfish' }).expect(409);

    expect(body.message).toContain('not the preference change waiting for confirmation');
    expect(await preferences()).toEqual([]);
  });

  it('validates the confirmed change', async () => {
    const id = await proposed();

    await confirm(id, {}).expect(400);
    await confirm(id, { ...peanut, action: 'replace' }).expect(400);
  });
});
