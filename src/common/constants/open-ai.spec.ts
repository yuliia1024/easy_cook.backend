import { createHash } from 'node:crypto';
import { ModelPrompt } from '../types';
import {
  GENERAL_CHAT_PROMPT,
  INTENT_PROMPT,
  MENU_DAY_PROMPT,
  MENU_MEAL_PROMPT,
  MENU_PLAN_PROMPT,
  PromptName,
  SUMMARY_PROMPT,
} from './open-ai';

const PROMPTS: ModelPrompt[] = [
  INTENT_PROMPT,
  MENU_PLAN_PROMPT,
  MENU_DAY_PROMPT,
  MENU_MEAL_PROMPT,
  GENERAL_CHAT_PROMPT,
  SUMMARY_PROMPT,
];

/**
 * The text every prompt version was released with. A changed prompt needs a new version: raise
 * `version` and put its new hash here, so the logs, menus and eval reports tell the two apart.
 */
const RELEASED: Record<PromptName, { version: number; sha256: string }> = {
  [PromptName.Intent]: {
    version: 6,
    sha256: '55b5d290636d244cd79bb1c2a0207bac52e0f8ca8d15619a2e624ec79a62b25f',
  },
  [PromptName.MenuPlan]: {
    version: 1,
    sha256: '0ff81dfc9db18ae2e166a8680f6eae237a9c877ea3a4a730a347fca70d50902d',
  },
  [PromptName.MenuDay]: {
    version: 1,
    sha256: 'ab50a49a6087ea3cdc82a921cccd06c2e6791357750a2317adc6c40113800344',
  },
  [PromptName.MenuMeal]: {
    version: 1,
    sha256: '4349556be8e70a1ff0315411993e69122e84c5a1372a6aaa969867e5cd735f3d',
  },
  [PromptName.GeneralChat]: {
    version: 6,
    sha256: '9e790e87c04c34dd1e9307836e397e2cd6b847027f77c86221254dd6aab28002',
  },
  [PromptName.Summary]: {
    version: 1,
    sha256: '4d6043f6b91931546531a7750c1e09964d2689ed192ca0150bdc8025bb1b8bce',
  },
};

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

describe('prompts', () => {
  it('has one prompt for every name', () => {
    expect(PROMPTS.map(({ name }) => name).sort()).toEqual(Object.values(PromptName).sort());
  });

  it.each(PROMPTS)('$name has a version for its text', ({ name, version, instructions }) => {
    expect({ version, sha256: sha256(instructions) }).toEqual(RELEASED[name as PromptName]);
  });
});
