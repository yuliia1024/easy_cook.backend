import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node --transpile-only prisma/seed.ts',
  },
  datasource: {
    // Not `env()`: that throws when unset, and `prisma generate` (npm install, docker build)
    // does not need a database. Migrate commands fail with a clear error without it.
    url: process.env.DATABASE_URL,
  },
});
