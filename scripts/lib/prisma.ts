import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';

/** A client for CLI scripts, on DATABASE_URL (the app builds its own in PrismaService). */
export function createPrismaClient(
  url: string | undefined = process.env.DATABASE_URL,
): PrismaClient {
  if (!url) {
    throw new Error('DATABASE_URL is not set (see .env.example)');
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}
