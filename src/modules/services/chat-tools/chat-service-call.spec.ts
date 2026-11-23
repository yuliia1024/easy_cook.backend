import { ChatToolName, Intent, MealType, MenuTargetScope } from '../../../common/constants';
import { EMPTY_MENU_REQUEST } from '../menu/menu-request';
import { toIntentResult } from './chat-service-call';

describe('toIntentResult', () => {
  const menuRequest = { ...EMPTY_MENU_REQUEST, days: 3 };

  it('reads plan_menu as a menu request without targets', () => {
    expect(
      toIntentResult({
        name: ChatToolName.PlanMenu,
        input: { request: 'Plan a 3-day menu.', menuRequest },
      }),
    ).toEqual({
      intent: Intent.GenerateMenu,
      request: 'Plan a 3-day menu.',
      menuRequest,
      targets: null,
      wishOffer: null,
    });
  });

  it('reads revise_menu as a revision with its targets', () => {
    const targets = [{ scope: MenuTargetScope.Meal, dayIndex: 1, mealType: MealType.Dinner }];

    expect(
      toIntentResult({
        name: ChatToolName.ReviseMenu,
        input: { request: 'Another dinner on day 2.', menuRequest, targets },
      }),
    ).toEqual({
      intent: Intent.ReviseMenu,
      request: 'Another dinner on day 2.',
      menuRequest,
      targets,
      wishOffer: null,
    });
  });
});
