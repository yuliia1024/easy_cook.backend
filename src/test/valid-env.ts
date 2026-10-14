/** A complete, valid environment for specs that build the real `ConfigService`. */
export const VALID_ENV: Record<string, string> = {
  PORT: '3100',
  ENV: 'local',
  CORS_ORIGINS: '*',
  SWAGGER_ENABLED: 'true',
  DATABASE_URL: 'postgresql://easy_cook:easy_cook@localhost:5442/easy_cook?schema=public',
  LOG_LEVEL: 'log',
};
