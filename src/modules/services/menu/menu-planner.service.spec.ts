import { MENU_PLANNER_STUB_REPLY } from '../../../common/constants';
import { MenuPlannerService } from './menu-planner.service';

describe('MenuPlannerService', () => {
  it('answers with the stub text until menu generation exists', async () => {
    await expect(new MenuPlannerService().plan('Plan 3 days')).resolves.toEqual({
      type: 'text',
      message: MENU_PLANNER_STUB_REPLY,
    });
  });
});
