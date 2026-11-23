/**
 * Indexes the migrations create but the Prisma schema cannot declare (pgvector HNSW): `prisma
 * migrate dev` sees them as drift and puts a `DROP INDEX` of each into every new migration.
 */
export const UNMANAGED_INDEXES: readonly string[] = ['recipe_embeddings_embedding_hnsw_idx'];

export interface StrippedMigration {
  sql: string;
  /** The indexes whose `DROP INDEX` was taken out. */
  removed: string[];
  /** Nothing but comments and blank lines is left: the migration only dropped them. */
  empty: boolean;
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Takes out the `DROP INDEX` of every unmanaged index, with the `-- DropIndex` comment above it. */
export function stripUnmanagedIndexDrops(
  sql: string,
  indexes: readonly string[] = UNMANAGED_INDEXES,
): StrippedMigration {
  const removed: string[] = [];
  let result = sql;
  for (const index of indexes) {
    const statement = new RegExp(
      `(?:^-- DropIndex\\r?\\n)?^DROP INDEX (?:IF EXISTS )?(?:"[^"]+"\\.)?"${escapeRegExp(index)}";[ \\t]*(?:\\r?\\n)*`,
      'gm',
    );
    if (statement.test(result)) {
      removed.push(index);
      result = result.replace(statement, '');
    }
  }
  const empty = result
    .split('\n')
    .every((line) => line.trim() === '' || line.trim().startsWith('--'));
  return { sql: removed.length > 0 ? `${result.trimEnd()}\n` : sql, removed, empty };
}
