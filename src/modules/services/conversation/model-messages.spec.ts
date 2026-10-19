import { MessageRole } from '../../../common/constants';
import { buildMessage } from '../../../test/fixtures';
import { toModelMessages } from './model-messages';

describe('toModelMessages', () => {
  it('keeps the order and passes only the role and the text', () => {
    expect(
      toModelMessages([
        buildMessage({ content: 'Hi' }),
        buildMessage({ role: MessageRole.Assistant, content: 'Hello' }),
      ]),
    ).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
    ]);
  });
});
