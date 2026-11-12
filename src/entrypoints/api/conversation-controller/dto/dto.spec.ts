import { plainToInstance } from 'class-transformer';
import {
  PreferenceChangeAction,
  PreferenceChangeStatus,
  PreferenceType,
} from '../../../../common/constants';
import { validate } from 'class-validator';
import {
  buildConversation,
  buildMessage,
  CONVERSATION_ID,
  MENU_ID,
} from '../../../../test/fixtures';
import {
  ConfirmPreferenceChangeDto,
  CreateConversationDto,
  SendMessageDto,
  UpdateConversationDto,
} from './conversation.dto';
import {
  ConversationResponseDto,
  ConversationSummaryResponseDto,
  PreferenceChangeResultResponseDto,
} from './conversation.response.dto';

async function errorsOf<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain));
  return errors.map((e) => e.property);
}

describe('conversation DTOs', () => {
  it('accepts an empty or full conversation', async () => {
    expect(await errorsOf(CreateConversationDto, {})).toEqual([]);
    expect(await errorsOf(CreateConversationDto, { title: 'Week', menuId: MENU_ID })).toEqual([]);
    expect(await errorsOf(UpdateConversationDto, { menuId: null })).toEqual([]);
    expect(await errorsOf(CreateConversationDto, { fromConversationId: CONVERSATION_ID })).toEqual(
      [],
    );
  });

  it('starts a conversation from another one only by its id', async () => {
    expect(await errorsOf(CreateConversationDto, { fromConversationId: 'chat' })).toEqual([
      'fromConversationId',
    ]);
    expect(await errorsOf(CreateConversationDto, { fromConversationId: null })).toEqual([]);
  });

  it.each([
    [{ title: null }, 'title'],
    [{ title: '  ' }, 'title'],
    [{ title: 'x'.repeat(256) }, 'title'],
    [{ menuId: 'menu' }, 'menuId'],
  ])('rejects %j', async (plain, field) => {
    expect(await errorsOf(UpdateConversationDto, plain)).toEqual([field]);
  });

  it('trims a message and limits its length', async () => {
    expect(plainToInstance(SendMessageDto, { content: ' hi ' }).content).toBe('hi');
    expect(await errorsOf(SendMessageDto, { content: 'x'.repeat(300) })).toEqual([]);
    expect(await errorsOf(SendMessageDto, { content: 'x'.repeat(301) })).toEqual(['content']);
    expect(await errorsOf(SendMessageDto, { content: '   ' })).toEqual(['content']);
    expect(await errorsOf(SendMessageDto, {})).toEqual(['content']);
  });

  it('accepts a confirmed preference change and trims its value', async () => {
    const plain = { action: 'add', preferenceType: 'allergy', value: ' peanut ' };

    expect(await errorsOf(ConfirmPreferenceChangeDto, plain)).toEqual([]);
    expect(plainToInstance(ConfirmPreferenceChangeDto, plain).value).toBe('peanut');
  });

  it.each([
    [{ action: 'replace', preferenceType: 'allergy', value: 'peanut' }, 'action'],
    [{ action: 'add', preferenceType: 'mood', value: 'peanut' }, 'preferenceType'],
    [{ action: 'add', preferenceType: 'allergy', value: ' ' }, 'value'],
    [{ action: 'add', preferenceType: 'allergy', value: 'x'.repeat(121) }, 'value'],
  ])('rejects the preference change %j', async (plain, field) => {
    expect(await errorsOf(ConfirmPreferenceChangeDto, plain)).toEqual([field]);
  });

  it('maps a summary with the message count', () => {
    const { messages: _messages, ...conversation } = buildConversation({ menuId: MENU_ID });

    expect(
      ConversationSummaryResponseDto.from({ ...conversation, _count: { messages: 4 } }),
    ).toEqual({
      id: CONVERSATION_ID,
      title: 'New conversation',
      menuId: MENU_ID,
      messageCount: 4,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    });
  });

  it('maps a conversation with its messages', () => {
    const message = buildMessage();
    const conversation = buildConversation({ messages: [message] });

    expect(ConversationResponseDto.from(conversation)).toEqual({
      id: CONVERSATION_ID,
      title: 'New conversation',
      menuId: null,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages: [
        {
          id: message.id,
          role: 'user',
          content: 'Plan a menu for 3 days',
          menuVersionId: null,
          menuId: null,
          preferenceChange: null,
          createdAt: message.createdAt,
        },
      ],
    });
  });

  it('links a reply to the menu of its version', () => {
    const message = buildMessage({
      menuVersionId: 'v1',
      menuVersion: { menuId: MENU_ID, compositionSnapshot: {} },
    });

    expect(
      ConversationResponseDto.from(buildConversation({ messages: [message] })).messages[0],
    ).toMatchObject({
      menuVersionId: 'v1',
      menuId: MENU_ID,
    });
  });

  describe('preference changes', () => {
    const change = {
      action: PreferenceChangeAction.Remove,
      preferenceType: PreferenceType.Diet,
      value: 'vegetarian',
    };

    it('shows the change a reply proposed, and none for a stored value that does not match', () => {
      const of = (preferenceChange: unknown) =>
        ConversationResponseDto.from(
          buildConversation({
            messages: [buildMessage({ preferenceChange: preferenceChange as never })],
          }),
        ).messages[0].preferenceChange;

      expect(of(change)).toEqual(change);
      expect(of({ ...change, action: 'replace' })).toBeNull();
    });

    it('maps the result of a confirmed change', () => {
      expect(
        PreferenceChangeResultResponseDto.from({ status: PreferenceChangeStatus.Applied, change }),
      ).toEqual({ status: PreferenceChangeStatus.Applied, change });
    });
  });
});
