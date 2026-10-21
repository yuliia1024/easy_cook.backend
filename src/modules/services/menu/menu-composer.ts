import { Injectable } from '@nestjs/common';
import { MenuIssue, ProfileContext } from '../../../common/types';
import { MenuVersionWithDays } from '../../data-access/menu/menu.repository';
import { composeMenu, resolveVersion } from './menu-composition';
import { validateMenu } from './menu-rules';

/**
 * Checks saved menu versions against the profile: recalculates the nutrition of every meal and
 * day from the recipe snapshots and validates the menu against the current goal and preferences.
 */
@Injectable()
export class MenuComposer {
  /** A saved version checked again against the current goal and preferences. */
  public revalidate(version: MenuVersionWithDays, context: ProfileContext): MenuIssue[] {
    const days = resolveVersion(version);
    return validateMenu(days, composeMenu(days).days, context.rules, context.nutritionGoal);
  }
}
