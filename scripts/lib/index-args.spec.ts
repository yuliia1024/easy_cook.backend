import { parseIndexArgs } from './index-args';

describe('parseIndexArgs', () => {
  it('syncs incrementally by default', () => {
    expect(parseIndexArgs([])).toEqual({ force: false, status: false, prune: false });
  });

  it('reads the flags', () => {
    expect(parseIndexArgs(['--force', '--prune'])).toEqual({
      force: true,
      status: false,
      prune: true,
    });
    expect(parseIndexArgs(['--status'])).toEqual({ force: false, status: true, prune: false });
  });

  it('rejects an unknown flag and --status with a change', () => {
    expect(() => parseIndexArgs(['--all'])).toThrow('Unknown argument --all');
    expect(() => parseIndexArgs(['--status', '--force'])).toThrow('--status changes nothing');
  });
});
