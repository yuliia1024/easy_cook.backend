import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadCases } from '../lib/cases';
import { ALL_SUITES } from '../lib/plan';
import { SUITES } from './index';
import { EVAL_TRIGGERS } from './triggers';

describe('EVAL_TRIGGERS', () => {
  const root = join(__dirname, '..', '..');

  it.each(EVAL_TRIGGERS.flatMap((trigger) => trigger.paths))('%s exists', (path) => {
    expect(existsSync(join(root, path))).toBe(true);
  });

  it('names known suites and tags their cases have', () => {
    for (const trigger of EVAL_TRIGGERS) {
      if (trigger.suites === ALL_SUITES) {
        expect(trigger.tags).toBeUndefined();
        continue;
      }
      for (const name of trigger.suites) {
        const suite = SUITES.find((candidate) => candidate.name === name);
        expect(suite).toBeDefined();
        const tags = new Set(
          loadCases(suite!.casesFile, suite!.caseSchema).flatMap((testCase) => testCase.tags),
        );
        expect((trigger.tags ?? []).filter((tag) => !tags.has(tag))).toEqual([]);
      }
    }
  });
});
