import { ALL_SUITES, EvalTrigger } from '../lib/plan';

/**
 * The code each suite runs, for `npm run eval -- --changed-since <ref>`. A suite also runs whole
 * when its folder changes or its prompt versions or model differ from its baseline, so a prompt
 * edit in `src/common/constants/open-ai.ts` needs no line here. Code a suite fakes (the services
 * behind the chat tools in `chat-tools/catalog.ts`) changes no result.
 */
export const EVAL_TRIGGERS: EvalTrigger[] = [
  {
    paths: [
      'src/providers/llm/',
      'src/common/constants/model-providers.ts',
      'package-lock.json',
    ],
    suites: ALL_SUITES,
  },
  {
    paths: [
      'src/modules/services/intent/',
      'src/modules/services/conversation/model-messages.ts',
      'src/modules/services/profile-context/model-profile.ts',
      'src/modules/services/menu/menu-target.ts',
      'src/modules/services/menu/menu-request.ts',
      'src/common/contracts/chat.ts',
    ],
    suites: ['intent', 'clarification'],
  },
  {
    paths: ['src/modules/services/menu/', 'src/common/contracts/chat.ts'],
    suites: ['menu-plan', 'menu-day'],
  },
  {
    paths: [
      'src/modules/services/general-chat/',
      'src/modules/services/chat-tools/',
      'src/modules/services/conversation/model-messages.ts',
      'src/modules/services/profile-context/model-profile.ts',
      'src/common/contracts/chat-tools.ts',
    ],
    suites: ['chat-tools'],
  },
  {
    paths: ['src/modules/services/nutrition/'],
    suites: ['chat-tools'],
    tags: ['numbers', 'calc'],
  },
  {
    paths: ['src/modules/services/menu/menu-rules.ts'],
    suites: ['chat-tools'],
    tags: ['search', 'allergy'],
  },
  {
    paths: ['src/modules/services/conversation/suggested-menu.ts'],
    suites: ['chat-tools'],
    tags: ['save', 'revise', 'menu-question'],
  },
  {
    paths: ['evals/lib/judge.ts'],
    suites: ['clarification'],
  },
];
