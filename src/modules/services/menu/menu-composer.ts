import { Injectable } from '@nestjs/common';
import { MenuComposition, MenuIssue, ProfileContext } from '../../../common/types';
import { MenuVersionWithDays } from '../../data-access/menu/menu.repository';
import { composeMenu, resolveVersion, ResolvedDay } from './menu-composition';
import { validateMenu } from './menu-rules';

/**
 * Composes menus and checks them against the profile: calculates the nutrition of every meal and
 * day from the recipe snapshots and validates the menu against the current goal and preferences.
 */
@Injectable()
export class MenuComposer {
  /** A new menu with its nutrition and the issues against the goal and preferences. */
  public compose(days: ResolvedDay[], context: ProfileContext): MenuComposition {
    const composed = composeMenu(days);
    return {
      ...composed,
      issues: validateMenu(days, composed.days, context.rules, context.nutritionGoal),
    };
  }

  /** A saved version checked again against the current goal and preferences. */
  public revalidate(version: MenuVersionWithDays, context: ProfileContext): MenuIssue[] {
    return this.compose(resolveVersion(version), context).issues;
  }
}
