import { ModelMessage } from 'ai';
import { MessageRole } from '../../../common/constants';
import { Message } from '../../../generated/prisma/client';

/** Saved messages as the model reads them, in the same order: role and text only. */
export function toModelMessages(messages: Pick<Message, 'role' | 'content'>[]): ModelMessage[] {
  return messages.map((message) => ({
    role: message.role === MessageRole.Assistant ? 'assistant' : 'user',
    content: message.content,
  }));
}
