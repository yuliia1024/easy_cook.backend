import { Injectable } from '@nestjs/common';
import { MENU_PLANNER_STUB_REPLY } from '../../../common/constants';
import { ChatResponse } from '../../../common/contracts';

/**
 * Plans a new menu from a chat request. A stub for now: it answers with a fixed text and calls
 * neither the model nor the database. The real planner must compose and validate the menu with
 * `MenuComposer` before it is sent as `menu_ready`.
 */
@Injectable()
export class MenuPlannerService {
  public async plan(_message: string): Promise<ChatResponse> {
    return { type: 'text', message: MENU_PLANNER_STUB_REPLY };
  }
}
