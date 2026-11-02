import { EvalSuite } from '../lib/types';
import { clarificationSuite } from './clarification/clarification.suite';
import { intentSuite } from './intent/intent.suite';
import { menuPlanSuite } from './menu-plan/menu-plan.suite';

/** Every suite `npm run eval` knows; `--suite` picks from these names. */
export const SUITES: EvalSuite[] = [intentSuite, menuPlanSuite, clarificationSuite];
