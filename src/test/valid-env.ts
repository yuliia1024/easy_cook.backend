/** A complete, valid environment for specs that build the real `ConfigService`. */
export const VALID_ENV: Record<string, string> = {
  PORT: '3100',
  ENV: 'local',
  CORS_ORIGINS: '*',
  SWAGGER_ENABLED: 'true',
  DATABASE_URL: 'postgresql://easy_cook:easy_cook@localhost:5442/easy_cook?schema=public',
  LOG_LEVEL: 'log',
  OPEN_AI_API_KEY: 'sk-test',
  REDIS_URL: 'redis://localhost:6389/0',
  GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
  AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
};
