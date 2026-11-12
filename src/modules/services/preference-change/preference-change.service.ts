import { Injectable } from '@nestjs/common';
import {
  PreferenceChangeAction,
  PreferenceChangeStatus,
  PreferenceType,
} from '../../../common/constants';
import { PreferenceChange } from '../../../common/contracts';
import {
  AllergyRemovalInChatBadRequestException,
  PreferenceChangeNotFoundException,
  PreferenceChangeOutdatedConflictException,
} from '../../../common/exceptions';
import { PreferenceChangeResult } from '../../../common/types';
import { ConversationService } from '../conversation/conversation.service';
import { pendingPreferenceChange } from '../conversation/pending-preference-change';
import { DietaryPreferenceService } from '../dietary-preference/dietary-preference.service';

/**
 * Changes of the dietary preferences the chat proposes. A proposal writes nothing: the reply keeps
 * it (`messages.preference_change`) and it is applied only when the user confirms it, by a yes in
 * the chat (`applyInChat`, the `apply_preference_change` tool) or by the confirm button of the API
 * (`confirm`). Removing an allergy needs the button: a yes the chat model reads wrong must not
 * drop one.
 */
@Injectable()
export class PreferenceChangeService {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly dietaryPreferenceService: DietaryPreferenceService,
  ) {}

  /**
   * The change to propose, normalized, or `already_applied` when it is in effect already. Writes
   * nothing; a change `POST /preferences` would refuse is refused the same way (400).
   */
  public async propose(change: PreferenceChange): Promise<PreferenceChangeResult> {
    const checked = await this.dietaryPreferenceService.checkChange(change);
    return {
      status: checked.inEffect
        ? PreferenceChangeStatus.AlreadyApplied
        : PreferenceChangeStatus.Proposed,
      change: checked.change,
    };
  }

  /**
   * The confirm button: applies the change the latest reply proposed, if it is the one the client
   * shows (`confirmed`); 409 for another one, e.g. of a reply that failed and was not saved. One in
   * effect already is not written again. 404 for a conversation of another profile or without a
   * pending change.
   */
  public async confirm(
    conversationId: string,
    confirmed: PreferenceChange,
  ): Promise<PreferenceChangeResult> {
    const change = await this.pending(conversationId);
    if (!sameChange(change, confirmed)) {
      throw new PreferenceChangeOutdatedConflictException();
    }
    return this.apply(change);
  }

  /**
   * A yes in the chat: applies the change the latest reply proposed, except the removal of an
   * allergy (400: the button only). 404 as `confirm`.
   */
  public async applyInChat(conversationId: string): Promise<PreferenceChangeResult> {
    const change = await this.pending(conversationId);
    if (
      change.action === PreferenceChangeAction.Remove &&
      change.preferenceType === PreferenceType.Allergy
    ) {
      throw new AllergyRemovalInChatBadRequestException();
    }
    return this.apply(change);
  }

  /** The change the latest reply proposed (`pendingPreferenceChange`); 404 when none. */
  private async pending(conversationId: string): Promise<PreferenceChange> {
    const conversation = await this.conversationService.getById(conversationId);
    const change = pendingPreferenceChange(conversation.messages);
    if (!change) {
      throw new PreferenceChangeNotFoundException();
    }
    return change;
  }

  private async apply(change: PreferenceChange): Promise<PreferenceChangeResult> {
    return { status: await this.dietaryPreferenceService.applyChange(change), change };
  }
}

/** The same change once values are compared as they are saved: trimmed, lower-cased. */
function sameChange(a: PreferenceChange, b: PreferenceChange): boolean {
  const value = (change: PreferenceChange): string => change.value.trim().toLowerCase();
  return a.action === b.action && a.preferenceType === b.preferenceType && value(a) === value(b);
}
