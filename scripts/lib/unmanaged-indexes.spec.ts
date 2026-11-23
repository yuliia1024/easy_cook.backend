import { stripUnmanagedIndexDrops, UNMANAGED_INDEXES } from './unmanaged-indexes';

describe('stripUnmanagedIndexDrops', () => {
  const drop = '-- DropIndex\nDROP INDEX "recipe_embeddings_embedding_hnsw_idx";\n';
  const change = '-- AlterTable\nALTER TABLE "recipes" ADD COLUMN "cuisine" VARCHAR(32);\n';

  it('knows the HNSW index of the recipe embeddings', () => {
    expect(UNMANAGED_INDEXES).toContain('recipe_embeddings_embedding_hnsw_idx');
  });

  it('takes out the drop and its comment, keeping the real change', () => {
    expect(stripUnmanagedIndexDrops(`${drop}\n${change}`)).toEqual({
      sql: change,
      removed: ['recipe_embeddings_embedding_hnsw_idx'],
      empty: false,
    });
    expect(stripUnmanagedIndexDrops(`${change}\n${drop}`).sql).toBe(change);
  });

  it('matches a schema-qualified or IF EXISTS drop', () => {
    const { removed } = stripUnmanagedIndexDrops(
      'DROP INDEX IF EXISTS "public"."recipe_embeddings_embedding_hnsw_idx";\n',
    );

    expect(removed).toEqual(['recipe_embeddings_embedding_hnsw_idx']);
  });

  it('says when nothing else is left', () => {
    expect(stripUnmanagedIndexDrops(drop)).toEqual({
      sql: '\n',
      removed: ['recipe_embeddings_embedding_hnsw_idx'],
      empty: true,
    });
  });

  it('leaves a migration without the drop as it is, other indexes too', () => {
    const other = '-- DropIndex\nDROP INDEX "recipes_name_trgm_idx";\n';

    expect(stripUnmanagedIndexDrops(other)).toEqual({ sql: other, removed: [], empty: false });
  });
});
