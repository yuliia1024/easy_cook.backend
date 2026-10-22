import { EvalSuite } from '../lib/types';
import { intentSuite } from './intent/intent.suite';

/** Every suite `npm run eval` knows; `--suite` picks from these names. */
export const SUITES: EvalSuite[] = [intentSuite];
