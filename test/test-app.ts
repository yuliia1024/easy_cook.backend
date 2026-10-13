import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '../src/generated/prisma/client';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/providers/prisma/prisma.service';

export interface TestApp {
  app: INestApplication<App>;
  prisma: PrismaService;
}

/** The real app (same pipes, filter and prefix as `main.ts`) on the test database. */
export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({ logger: false });
  configureApp(app);
  await app.init();

  return { app, prisma: app.get(PrismaService) };
}

/** Empties every table except Prisma's migration log. */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length > 0) {
    const list = tables.map(({ tablename }) => `"public"."${tablename}"`).join(', ');
    await prisma.$executeRaw`TRUNCATE TABLE ${Prisma.raw(list)} CASCADE`;
  }
}
