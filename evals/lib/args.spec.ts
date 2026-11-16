import { ModelProviderName } from '../../src/common/constants';
import { DEFAULT_CONCURRENCY, DEFAULT_REPEAT, parseEvalArgs } from './args';

describe('eval args', () => {
  const known = ['intent', 'menu'];

  it('runs every suite by default', () => {
    expect(parseEvalArgs([], known)).toEqual({
      suites: [],
      tags: [],
      changedSince: null,
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
      tags: [],
      changedSince: null,
      saveBaseline: true,
      concurrency: 2,
      repeat: 1,
      provider: ModelProviderName.DeepSeek,
    });
  });

  it('filters by tag, comma separated or repeated, without duplicates', () => {
    expect(
      parseEvalArgs(['--suite', 'intent', '--tag', 'save, uk', '--tag', 'save'], known),
    ).toMatchObject({ suites: ['intent'], tags: ['save', 'uk'] });
  });

  it('takes the ref the changes are counted from', () => {
    expect(parseEvalArgs(['--changed-since', 'origin/main'], known)).toMatchObject({
      suites: [],
      tags: [],
      changedSince: 'origin/main',
    });
  });

  it.each([[['--suite', 'intent']], [['--tag', 'save']]])(
    'rejects --changed-since with %j',
    (extra) => {
      expect(() => parseEvalArgs(['--changed-since', 'main', ...extra], known)).toThrow(
        '--changed-since picks the suites and tags itself; drop --suite and --tag',
      );
    },
  );

  it.each([[['--tag', 'save']], [['--changed-since', 'main']]])(
    'rejects --save-baseline with %j',
    (extra) => {
      expect(() => parseEvalArgs(['--save-baseline', ...extra], known)).toThrow(
        '--save-baseline records whole suites; drop --tag and --changed-since',
      );
    },
  );

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
