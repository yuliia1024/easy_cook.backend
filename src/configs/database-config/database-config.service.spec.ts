import { PrismaPg } from '@prisma/adapter-pg';
import { fakeConfig } from '../../test/fake-config';
import { DatabaseConfigService } from './database-config.service';

describe('DatabaseConfigService', () => {
  const url = 'postgresql://u:p@db:5442/d';

  it('exposes DATABASE_URL', () => {
    expect(new DatabaseConfigService(fakeConfig({ DATABASE_URL: url })).url).toBe(url);
  });

  it('connects through the pg driver adapter', () => {
    const { adapter } = new DatabaseConfigService(fakeConfig({ DATABASE_URL: url })).config();

    expect(adapter).toBeInstanceOf(PrismaPg);
  });

  it('logs queries only when asked to', () => {
    const quiet = new DatabaseConfigService(fakeConfig({ DATABASE_URL: url }));
    const verbose = new DatabaseConfigService(
      fakeConfig({ DATABASE_URL: url, POSTGRES_LOGGING: 'true' }),
    );

    expect(quiet.config().log).toEqual(['warn', 'error']);
    expect(verbose.config().log).toEqual(['query', 'warn', 'error']);
  });
});
