import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { EvalCase } from './types';

/**
 * Parses a JSONL text: one case per non-blank line, each checked with `schema`. Fails on the first
 * bad line with `source:line`, and on a repeated id.
 */
export function parseCases<T extends EvalCase>(
  text: string,
  schema: z.ZodType<T, unknown>,
  source: string,
): T[] {
  const cases: T[] = [];
  const ids = new Set<string>();

  text.split('\n').forEach((line, index) => {
    if (line.trim() === '') {
      return;
    }
    const where = `${source}:${index + 1}`;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new Error(`${where}: not valid JSON`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new Error(`${where}: ${z.prettifyError(parsed.error)}`);
    }
    if (ids.has(parsed.data.id)) {
      throw new Error(`${where}: duplicate id "${parsed.data.id}"`);
    }
    ids.add(parsed.data.id);
    cases.push(parsed.data);
  });

  if (cases.length === 0) {
    throw new Error(`${source}: no cases`);
  }
  return cases;
}

export function loadCases<T extends EvalCase>(file: string, schema: z.ZodType<T, unknown>): T[] {
  return parseCases(readFileSync(file, 'utf8'), schema, file);
}
