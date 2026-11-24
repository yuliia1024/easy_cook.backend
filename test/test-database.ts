import 'dotenv/config';

/**
 * e2e tests run against TEST_DATABASE_URL, never against the dev database: every test file
 * truncates all tables.
 */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('Set TEST_DATABASE_URL (see .env.example) to run the e2e tests');
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL: e2e tests wipe the data');
  }
  return url;
}

/** e2e tests run against TEST_REDIS_URL (another database), never the dev one: it is flushed. */
export function testRedisUrl(): string {
  const url = process.env.TEST_REDIS_URL;
  if (!url) {
    throw new Error('Set TEST_REDIS_URL (see .env.example) to run the e2e tests');
  }
  if (url === process.env.REDIS_URL) {
    throw new Error('TEST_REDIS_URL must differ from REDIS_URL: e2e tests flush it');
  }
  return url;
}
