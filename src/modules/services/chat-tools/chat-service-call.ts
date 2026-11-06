import { ChatToolName, Intent } from '../../../common/constants';
import { IntentResult } from '../../../common/contracts';
import { ChatServiceCall } from '../../../common/types';

/**
 * A menu tool call as the classification of a menu request, so the backend plans it on the same
 * path: the request merged into the chat, the questions it asks, the planner and its checks, the
 * saved version. Pure.
 */
export function toIntentResult(call: ChatServiceCall): IntentResult {
  switch (call.name) {
    case ChatToolName.PlanMenu:
      return {
        intent: Intent.GenerateMenu,
        request: call.input.request,
        menuRequest: call.input.menuRequest,
        targets: null,
      };
    case ChatToolName.ReviseMenu:
      return {
        intent: Intent.ReviseMenu,
        request: call.input.request,
        menuRequest: call.input.menuRequest,
        targets: call.input.targets,
      };
    default: {
      const unknown: never = call;
      throw new Error(`Unhandled service call "${JSON.stringify(unknown)}"`);
    }
  }
}
