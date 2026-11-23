/**
 * Runs after `prisma migrate dev --create-only` (`npm run migration:create`): takes the
 * `DROP INDEX` of the indexes Prisma cannot declare (`UNMANAGED_INDEXES`, pgvector HNSW) out of
 * the newest migration, and deletes it when that was all it did. Never touches a migration git
 * already tracks: committed migrations are never edited.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripUnmanagedIndexDrops } from './lib/unmanaged-indexes';

const MIGRATIONS_DIR = join(__dirname, '..', 'prisma', 'migrations');

function isTracked(file: string): boolean {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', file], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function main(): void {
  const newest = readdirSync(MIGRATIONS_DIR)
    .filter((name) => statSync(join(MIGRATIONS_DIR, name)).isDirectory())
    .sort()
    .at(-1);
  if (!newest) {
    return;
  }
  const file = join(MIGRATIONS_DIR, newest, 'migration.sql');
  if (isTracked(file)) {
    return;
  }
  const { sql, removed, empty } = stripUnmanagedIndexDrops(readFileSync(file, 'utf8'));
  if (removed.length === 0) {
    return;
  }
  if (empty) {
    rmSync(join(MIGRATIONS_DIR, newest), { recursive: true });
    console.log(`${newest}: only dropped ${removed.join(', ')} - deleted, the schema is in sync`);
    return;
  }
  writeFileSync(file, sql);
  console.log(
    `${newest}: kept ${removed.join(', ')} (not in the Prisma schema), its DROP INDEX taken out`,
  );
}

main();
