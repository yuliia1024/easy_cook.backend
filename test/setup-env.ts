import { testDatabaseUrl, testRedisUrl } from './test-database';

process.env.DATABASE_URL = testDatabaseUrl();
process.env.REDIS_URL = testRedisUrl();
