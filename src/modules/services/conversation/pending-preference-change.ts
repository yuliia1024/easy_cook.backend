import { MessageRole } from '../../../common/constants';
import { PreferenceChange, PreferenceChangeSchema } from '../../../common/contracts';
import { MessageWithMenu } from '../../data-access/conversation/conversation.repository';

/**
 * The preference change waiting for the user's yes: the one the latest assistant reply proposed.
 * A later reply without one ends it, so a yes to another question never applies an old proposal.
 * A stored value that no longer matches the schema is none. Pure.
 */
export function pendingPreferenceChange(
  messages: Array<
    Pick<MessageWithMenu, 'role'> & Partial<Pick<MessageWithMenu, 'preferenceChange'>>
  >,
): PreferenceChange | null {
  const latest = [...messages].reverse().find(({ role }) => role === MessageRole.Assistant);
  const parsed = PreferenceChangeSchema.safeParse(latest?.preferenceChange);
  return parsed.success ? parsed.data : null;
}
