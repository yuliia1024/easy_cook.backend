import { PrismaPg } from '@prisma/adapter-pg';
import { fakeConfig } from '../../test/fake-config';
import { DatabaseConfigService } from './database-config.service';

describe('DatabaseConfigService', () => {
  const url = 'postgresql://u:p@db:5442/d';

  it('exposes DATABASE_URL', () => {
    expect(new DatabaseConfigService(fakeConfig({ DATABASE_URL: url })).url).toBe(url);
  });

  it('logs the values of queries only with ENV=local', () => {
    expect(new DatabaseConfigService(fakeConfig({ ENV: 'local' })).logsQueryParams).toBe(true);
    expect(new DatabaseConfigService(fakeConfig({ ENV: 'staging' })).logsQueryParams).toBe(false);
    expect(new DatabaseConfigService(fakeConfig({})).logsQueryParams).toBe(false);
  });

  it('connects through the pg driver adapter', () => {
    const { adapter } = new DatabaseConfigService(fakeConfig({ DATABASE_URL: url })).config();

    expect(adapter).toBeInstanceOf(PrismaPg);
  });

  it('emits queries, warnings and errors as events for the app logger', () => {
    const { log } = new DatabaseConfigService(fakeConfig({ DATABASE_URL: url })).config();

    expect(log).toEqual([
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ]);
  });
});
