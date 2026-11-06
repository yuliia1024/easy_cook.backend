import { EvalSuite } from '../lib/types';
import { chatToolsSuite } from './chat-tools/chat-tools.suite';
import { clarificationSuite } from './clarification/clarification.suite';
import { intentSuite } from './intent/intent.suite';
import { menuDaySuite } from './menu-day/menu-day.suite';
import { menuPlanSuite } from './menu-plan/menu-plan.suite';

/** Every suite `npm run eval` knows; `--suite` picks from these names. */
export const SUITES: EvalSuite[] = [
  intentSuite,
  menuPlanSuite,
  clarificationSuite,
  menuDaySuite,
  chatToolsSuite,
];
