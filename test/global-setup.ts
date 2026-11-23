import { execSync } from 'child_process';
import { Redis } from 'ioredis';
import { testDatabaseUrl, testRedisUrl } from './test-database';

/** Creates the test database if needed, applies every migration to it and empties the test Redis. */
export default async function globalSetup(): Promise<void> {
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: 'ignore',
  });
  const redis = new Redis(testRedisUrl());
  try {
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }
}
