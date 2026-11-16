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

  it.each(['0', '65536', '3100.5', '-1'])('rejects the port %p', (port) => {
    process.env.PORT = port;

    expect(() => new ConfigService()).toThrow(/PORT/);
  });

  it.each([
    ['any origin outside production', 'local', '*'],
    ['no origins outside production', 'local', undefined],
    ['a list of origins on production', 'production', 'https://a.com, https://b.com'],
  ])('accepts %s', (_case, env, origins) => {
    process.env.ENV = env;
    if (origins === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = origins;

    expect(() => new ConfigService()).not.toThrow();
  });

  it.each([
    ['any origin on production', 'production', '*'],
    ['no origins on production', 'production', undefined],
    ['an origin without a scheme', 'local', 'a.com'],
  ])('rejects %s', (_case, env, origins) => {
    process.env.ENV = env;
    if (origins === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = origins;

    expect(() => new ConfigService()).toThrow(/CORS_ORIGINS/);
  });

  it('rejects a database url of another driver', () => {
    process.env.DATABASE_URL = 'mysql://u:p@localhost/db';

    expect(() => new ConfigService()).toThrow(/DATABASE_URL/);
  });

  it('fails fast without an OpenAI api key', () => {
    process.env.OPEN_AI_API_KEY = '';

    expect(() => new ConfigService()).toThrow(/OPEN_AI_API_KEY/);
  });

  it.each(['openai', 'deepseek,openai', 'openai , deepseek'])(
    'accepts the providers %p with their keys',
    (providers) => {
      process.env.MODEL_PROVIDERS = providers;
      process.env.DEEPSEEK_API_KEY = 'sk-ds';

      expect(() => new ConfigService()).not.toThrow();
    },
  );

  it.each(['mistral', 'openai,', 'openai;deepseek'])('rejects the providers %p', (providers) => {
    process.env.MODEL_PROVIDERS = providers;

    expect(() => new ConfigService()).toThrow(/MODEL_PROVIDERS/);
  });

  it('requires DEEPSEEK_API_KEY only when MODEL_PROVIDERS has deepseek', () => {
    process.env.MODEL_PROVIDERS = 'openai';
    expect(() => new ConfigService()).not.toThrow();

    process.env.MODEL_PROVIDERS = 'openai,deepseek';
    expect(() => new ConfigService()).toThrow(/DEEPSEEK_API_KEY/);
  });

  it('requires ANTHROPIC_API_KEY only when MODEL_PROVIDERS has anthropic', () => {
    process.env.MODEL_PROVIDERS = 'openai,anthropic';

    expect(() => new ConfigService()).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('rejects an unknown environment name', () => {
    process.env.ENV = 'qa';

    expect(() => new ConfigService()).toThrow(/ENV/);
  });
});
