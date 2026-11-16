import { ModelProviderName } from '../../src/common/constants';
import { DEFAULT_CONCURRENCY, DEFAULT_REPEAT, parseEvalArgs } from './args';

describe('eval args', () => {
  const known = ['intent', 'menu'];

  it('runs every suite by default', () => {
    expect(parseEvalArgs([], known)).toEqual({
      suites: [],
      saveBaseline: false,
      concurrency: DEFAULT_CONCURRENCY,
      repeat: DEFAULT_REPEAT,
      provider: ModelProviderName.OpenAi,
    });
  });

  it('filters by suite, comma separated or repeated, without duplicates', () => {
    expect(
      parseEvalArgs(
        [
          '--suite',
          'intent, menu',
          '--suite',
          'intent',
          '--save-baseline',
          '--concurrency',
          '2',
          '--repeat',
          '1',
          '--provider',
          'deepseek',
        ],
        known,
      ),
    ).toEqual({
      suites: ['intent', 'menu'],
      saveBaseline: true,
      concurrency: 2,
      repeat: 1,
      provider: ModelProviderName.DeepSeek,
    });
  });

  it('rejects an unknown suite', () => {
    expect(() => parseEvalArgs(['--suite', 'nope'], known)).toThrow(
      'Unknown suite: nope. Known: intent, menu',
    );
  });

  it('rejects an unknown provider', () => {
    expect(() => parseEvalArgs(['--provider', 'mistral'], known)).toThrow(
      'Unknown provider: mistral. Known: openai, deepseek',
    );
  });

  it.each([
    ['concurrency', '0'],
    ['concurrency', '-1'],
    ['repeat', '1.5'],
    ['repeat', 'x'],
  ])('rejects --%s=%s', (name, value) => {
    expect(() => parseEvalArgs([`--${name}=${value}`], known)).toThrow(
      `--${name} must be a positive integer`,
    );
  });

  it('rejects an unknown option', () => {
    expect(() => parseEvalArgs(['--verbose'], known)).toThrow();
  });
});
