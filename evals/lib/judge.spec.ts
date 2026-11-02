import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAiService } from '../../src/providers/open-ai/open-ai.service';
import { createMock } from '../../src/test/create-mock';
import {
  JUDGE_INSTRUCTIONS,
  JUDGE_MODEL,
  judgeModelCall,
  judgeSchema,
  judgeScores,
  loadRubric,
  Rubric,
  runJudge,
} from './judge';

describe('judge', () => {
  const rubric: Rubric<'clear' | 'polite'> = {
    criteria: ['clear', 'polite'],
    text: '## clear\nIs clear.\n## polite\nIs polite.\n',
  };

  describe('loadRubric', () => {
    const write = (text: string): string => {
      const file = join(mkdtempSync(join(tmpdir(), 'rubric-')), 'rubric.md');
      writeFileSync(file, text);
      return file;
    };

    it('reads the rubric with a section for every criterion', () => {
      expect(loadRubric(write(rubric.text), rubric.criteria)).toEqual(rubric);
    });

    it('rejects a rubric without a section for a criterion', () => {
      const file = write('## clear\nIs clear.\n### polite\n');

      expect(() => loadRubric(file, rubric.criteria)).toThrow(`${file} has no section for: polite`);
    });
  });

  describe('judgeSchema', () => {
    it('takes a reason and a verdict for every criterion', () => {
      const schema = judgeSchema(rubric.criteria);
      const verdict = {
        clear: { reason: 'Short.', pass: true },
        polite: { reason: 'Rude.', pass: false },
      };

      expect(schema.parse(verdict)).toEqual(verdict);
      expect(schema.safeParse({ clear: verdict.clear }).success).toBe(false);
    });
  });

  it('calls the judge model with the rubric and the subject as JSON', async () => {
    const openAi = createMock<OpenAiService>();
    const result = {
      output: { clear: { reason: 'r', pass: true }, polite: { reason: 'r', pass: true } },
      modelId: 'gpt-4.1',
      latencyMs: 1,
      usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 },
    };
    openAi.generateStructuredResult.mockResolvedValue(result);

    await expect(runJudge(openAi, rubric, { reply: 'Hi?' })).resolves.toBe(result);

    const { options } = judgeModelCall(rubric, { reply: 'Hi?' });
    expect(options).toMatchObject({
      instructions: `${JUDGE_INSTRUCTIONS}${rubric.text}`,
      model: JUDGE_MODEL,
    });
    expect(openAi.generateStructuredResult).toHaveBeenCalledWith(
      '{"reply":"Hi?"}',
      expect.anything(),
      options,
    );
  });

  describe('judgeScores', () => {
    it('scores every criterion by the verdict', () => {
      const verdict = {
        clear: { reason: 'Short.', pass: true },
        polite: { reason: 'Rude.', pass: false },
      };

      expect(judgeScores(rubric, verdict)).toEqual([
        { field: 'judge.clear', pass: true, expected: 'pass', actual: verdict.clear },
        { field: 'judge.polite', pass: false, expected: 'pass', actual: verdict.polite },
      ]);
    });

    it('fails every criterion without a verdict', () => {
      expect(judgeScores(rubric, null).map(({ pass }) => pass)).toEqual([false, false]);
    });
  });
});
