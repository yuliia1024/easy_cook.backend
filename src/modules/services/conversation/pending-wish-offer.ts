import { MessageRole } from '../../../common/constants';
import { WishOffer, WishOfferSchema } from '../../../common/contracts';
import { MessageWithMenu } from '../../data-access/conversation/conversation.repository';

/**
 * The wish offer waiting for the user's answer: the one the latest assistant reply made. A later
 * reply without one ends it, so an answer to another question never takes up an old offer. A
 * stored value that no longer matches the schema is none. Pure.
 */
export function pendingWishOffer(
  messages: Array<Pick<MessageWithMenu, 'role'> & Partial<Pick<MessageWithMenu, 'wishOffer'>>>,
): WishOffer | null {
  const latest = [...messages].reverse().find(({ role }) => role === MessageRole.Assistant);
  const parsed = WishOfferSchema.safeParse(latest?.wishOffer);
  return parsed.success ? parsed.data : null;
}
