import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  buildConversation,
  buildMessage,
  CONVERSATION_ID,
  MENU_ID,
} from '../../../../test/fixtures';
import { CreateConversationDto, SendMessageDto, UpdateConversationDto } from './conversation.dto';
import {
  ConversationResponseDto,
  ConversationSummaryResponseDto,
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
          suggestedMenu: null,
          createdAt: message.createdAt,
        },
      ],
    });
  });

  it('links a reply to the menu of its version', () => {
    const message = buildMessage({ menuVersionId: 'v1', menuVersion: { menuId: MENU_ID } });

    expect(
      ConversationResponseDto.from(buildConversation({ messages: [message] })).messages[0],
    ).toMatchObject({
      menuVersionId: 'v1',
      menuId: MENU_ID,
    });
  });

  it('returns the menu a reply suggested', () => {
    const suggestedMenu = {
      days: [],
      dailyAverage: { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 },
      issues: [],
    };
    const message = buildMessage({ role: 'assistant', suggestedMenu });

    expect(
      ConversationResponseDto.from(buildConversation({ messages: [message] })).messages[0]
        .suggestedMenu,
    ).toEqual(suggestedMenu);
  });
});
