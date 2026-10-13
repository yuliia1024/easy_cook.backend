import { VALID_ENV } from '../test/valid-env';
import { ConfigService } from './config.service';

describe('ConfigService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...VALID_ENV };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('reads raw values', () => {
    expect(new ConfigService().get('DATABASE_URL')).toBe(VALID_ENV.DATABASE_URL);
  });

  it('converts numbers and booleans', () => {
    const config = new ConfigService();

    expect(config.getNumber('PORT')).toBe(3100);
    expect(config.getBoolean('SWAGGER_ENABLED')).toBe(true);
    expect(config.getBoolean('POSTGRES_LOGGING')).toBe(false);
  });

  it('treats a missing optional boolean as false', () => {
    delete process.env.SWAGGER_ENABLED;

    expect(new ConfigService().getBoolean('SWAGGER_ENABLED')).toBe(false);
  });

  it('fails fast when a required variable is missing', () => {
    delete process.env.DATABASE_URL;

    expect(() => new ConfigService()).toThrow(/DATABASE_URL/);
  });

  it('fails fast on a malformed value', () => {
    process.env.PORT = 'not-a-number';

    expect(() => new ConfigService()).toThrow(/PORT/);
  });

  it('rejects a database url of another driver', () => {
    process.env.DATABASE_URL = 'mysql://u:p@localhost/db';

    expect(() => new ConfigService()).toThrow(/DATABASE_URL/);
  });

  it('rejects an unknown environment name', () => {
    process.env.ENV = 'qa';

    expect(() => new ConfigService()).toThrow(/ENV/);
  });
});
