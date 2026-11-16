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
    version: 5,
    sha256: '26e103eaaa5edaa2f518dcfec6a24df458a5a91c19b6d90262c5beff9c32a944',
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
    version: 4,
    sha256: '2b7ab2252721fe3aeff18d32e9856034d20c95133d6a57c66beb9ecb3c53d44f',
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
