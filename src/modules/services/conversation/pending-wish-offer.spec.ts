import { MealType, MessageRole } from '../../../common/constants';
import { RECIPE_ID } from '../../../test/fixtures';
import { pendingWishOffer } from './pending-wish-offer';

describe('pendingWishOffer', () => {
  const offer = {
    wishes: 'sushi',
    recipes: [{ id: RECIPE_ID, name: 'Salmon poke bowl', mealType: MealType.Lunch }],
  };
  const user = { role: MessageRole.User, wishOffer: null };
  const reply = (wishOffer: unknown = null) => ({
    role: MessageRole.Assistant,
    wishOffer: wishOffer as never,
  });

  it('is the offer of the latest reply, also after the next user message', () => {
    expect(pendingWishOffer([user, reply(offer)])).toEqual(offer);
    expect(pendingWishOffer([user, reply(offer), user])).toEqual(offer);
  });

  it('is null once a later reply offered nothing', () => {
    expect(pendingWishOffer([user, reply(offer), user, reply()])).toBeNull();
  });

  it('is null without a reply or for a stored value that does not match the schema', () => {
    expect(pendingWishOffer([])).toBeNull();
    expect(pendingWishOffer([reply({ ...offer, recipes: [] })])).toBeNull();
  });
});
