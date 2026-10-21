import { Goal, MenuIssueCode } from '../../../common/constants';
import { buildMenuVersion, PROFILE_ID } from '../../../test/fixtures';
import { MenuComposer } from './menu-composer';

describe('MenuComposer', () => {
  it('revalidates a saved version against the current rules', () => {
    const issues = new MenuComposer().revalidate(buildMenuVersion(), {
      profileId: PROFILE_ID,
      goal: Goal.Maintain,
      nutritionGoal: null,
      rules: { diets: ['gluten_free'], allergies: [], excludedIngredients: [], dislikedFoods: [] },
    });

    expect(issues).toEqual([
      expect.objectContaining({
        code: MenuIssueCode.DietViolation,
        message: 'Day 1, lunch: Rice with vegetables is not gluten_free',
      }),
    ]);
  });
});
