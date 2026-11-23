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
    ['the local origins locally', 'local', '*'],
    ['no origins locally', 'local', undefined],
    ['a list of origins on production', 'production', 'https://a.com, https://b.com'],
  ])('accepts %s', (_case, env, origins) => {
    process.env.ENV = env;
    process.env.REDIS_URL = `redis://:${'x'.repeat(16)}@redis:6379/0`;
    if (origins === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = origins;

    expect(() => new ConfigService()).not.toThrow();
  });

  it.each([
    ['any origin on production', 'production', '*'],
    ['no origins on production', 'production', undefined],
    ['any origin on staging', 'staging', '*'],
    ['no origins on development', 'development', ''],
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

  it('accepts the embedding providers and the Ollama url, and rejects unknown ones', () => {
    process.env.EMBEDDING_PROVIDERS = 'ollama, openai';
    process.env.OLLAMA_BASE_URL = 'http://ollama:11434';
    expect(() => new ConfigService()).not.toThrow();

    process.env.EMBEDDING_PROVIDERS = 'ollama,cohere';
    expect(() => new ConfigService()).toThrow(/EMBEDDING_PROVIDERS/);

    process.env.EMBEDDING_PROVIDERS = 'openai';
    process.env.OLLAMA_BASE_URL = 'ollama:11434';
    expect(() => new ConfigService()).toThrow(/OLLAMA_BASE_URL/);
  });

  it('rejects an unknown environment name', () => {
    process.env.ENV = 'qa';

    expect(() => new ConfigService()).toThrow(/ENV/);
  });

  it.each(['REDIS_URL', 'GOOGLE_CLIENT_ID', 'AUTH_SECRET'])('fails fast without %s', (key) => {
    delete process.env[key];

    expect(() => new ConfigService()).toThrow(new RegExp(key));
  });

  it('rejects a short auth secret and a non-redis url', () => {
    process.env.AUTH_SECRET = 'short';
    process.env.REDIS_URL = 'http://localhost:6379';

    expect(() => new ConfigService()).toThrow(
      /AUTH_SECRET[\s\S]*REDIS_URL|REDIS_URL[\s\S]*AUTH_SECRET/,
    );
  });

  it('accepts a list of allowed emails and rejects anything else', () => {
    process.env.AUTH_ALLOWED_EMAILS = 'a@example.com, b@example.org';
    expect(() => new ConfigService()).not.toThrow();

    process.env.AUTH_ALLOWED_EMAILS = 'a@example.com; nobody';
    expect(() => new ConfigService()).toThrow(/AUTH_ALLOWED_EMAILS/);
  });

  it('allows an insecure cookie only locally and never with SameSite=none', () => {
    process.env.AUTH_COOKIE_SECURE = 'false';
    expect(() => new ConfigService()).not.toThrow();

    process.env.AUTH_COOKIE_SAME_SITE = 'none';
    expect(() => new ConfigService()).toThrow(/AUTH_COOKIE_SECURE/);

    process.env.AUTH_COOKIE_SAME_SITE = 'lax';
    process.env.ENV = 'staging';
    expect(() => new ConfigService()).toThrow(/AUTH_COOKIE_SECURE/);

    process.env.AUTH_COOKIE_SECURE = 'yes';
    process.env.ENV = 'local';
    expect(() => new ConfigService()).toThrow(/AUTH_COOKIE_SECURE/);
  });

  it('requires a Redis password outside local', () => {
    process.env.ENV = 'staging';
    process.env.CORS_ORIGINS = 'https://app.example.com';
    expect(() => new ConfigService()).toThrow(/REDIS_URL/);

    process.env.REDIS_URL = 'rediss://:secret@redis.internal:6379/0';
    expect(() => new ConfigService()).not.toThrow();
  });

  it('accepts a number of trusted proxies', () => {
    process.env.TRUST_PROXY_HOPS = '1';
    expect(() => new ConfigService()).not.toThrow();

    process.env.TRUST_PROXY_HOPS = '-1';
    expect(() => new ConfigService()).toThrow(/TRUST_PROXY_HOPS/);
  });

  it.each(['AUTH_ALLOWED_EMAILS', 'AUTH_COOKIE_SECURE', 'AUTH_COOKIE_SAME_SITE'])(
    'takes an empty %s as unset',
    (key) => {
      process.env[key] = '';

      expect(() => new ConfigService()).not.toThrow();
    },
  );

  it('rejects an unknown SameSite', () => {
    process.env.AUTH_COOKIE_SAME_SITE = 'loose';

    expect(() => new ConfigService()).toThrow(/AUTH_COOKIE_SAME_SITE/);
  });
});
