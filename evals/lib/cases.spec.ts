import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCases, parseCases } from './cases';
import { EchoCaseSchema } from '../test/helpers';

describe('eval cases', () => {
  it('parses one case per line, skips blank lines and defaults the tags', () => {
    const text = '{"id":"a","answer":"x","tags":["en"]}\n\n{"id":"b","answer":"y"}\n';

    expect(parseCases(text, EchoCaseSchema, 'cases.jsonl')).toEqual([
      { id: 'a', answer: 'x', tags: ['en'] },
      { id: 'b', answer: 'y', tags: [] },
    ]);
  });

  it('names the line that is not JSON', () => {
    expect(() => parseCases('{"id":"a","answer":"x"}\n{oops', EchoCaseSchema, 'c.jsonl')).toThrow(
      'c.jsonl:2: not valid JSON',
    );
  });

  it('names the line that does not match the schema', () => {
    expect(() => parseCases('{"id":"a"}', EchoCaseSchema, 'c.jsonl')).toThrow(
      /^c\.jsonl:1: .*answer/s,
    );
  });

  it('rejects a repeated id', () => {
    const text = '{"id":"a","answer":"x"}\n{"id":"a","answer":"y"}';

    expect(() => parseCases(text, EchoCaseSchema, 'c.jsonl')).toThrow(
      'c.jsonl:2: duplicate id "a"',
    );
  });

  it('rejects a file without cases', () => {
    expect(() => parseCases('\n\n', EchoCaseSchema, 'c.jsonl')).toThrow('c.jsonl: no cases');
  });

  it('loads a file', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'evals-')), 'cases.jsonl');
    writeFileSync(file, '{"id":"a","answer":"x"}\n');

    expect(loadCases(file, EchoCaseSchema)).toEqual([{ id: 'a', answer: 'x', tags: [] }]);
  });
});
