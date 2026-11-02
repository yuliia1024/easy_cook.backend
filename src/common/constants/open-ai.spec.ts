import { createHash } from 'node:crypto';
import { ModelPrompt } from '../types';
import {
  GENERAL_CHAT_PROMPT,
  INTENT_PROMPT,
  MENU_PLAN_PROMPT,
  PromptName,
  SUMMARY_PROMPT,
} from './open-ai';

const PROMPTS: ModelPrompt[] = [
  INTENT_PROMPT,
  MENU_PLAN_PROMPT,
  GENERAL_CHAT_PROMPT,
  SUMMARY_PROMPT,
];

/**
 * The text every prompt version was released with. A changed prompt needs a new version: raise
 * `version` and put its new hash here, so the logs, menus and eval reports tell the two apart.
 */
const RELEASED: Record<PromptName, { version: number; sha256: string }> = {
  [PromptName.Intent]: {
    version: 1,
    sha256: '80d2d7c2a5a8bfdf2f725da17c717573765f26d18d933fc0c42439ec9e9d0e64',
  },
  [PromptName.MenuPlan]: {
    version: 1,
    sha256: '0ff81dfc9db18ae2e166a8680f6eae237a9c877ea3a4a730a347fca70d50902d',
  },
  [PromptName.GeneralChat]: {
    version: 1,
    sha256: '8bba4e7bfd01395549c7cebc4ca01f4d7fb1b33a37c77f12f3c9243b2b16f90b',
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
