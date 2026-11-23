import { Prisma } from '../../../generated/prisma/client';
import { RECIPE_SEARCH_EF_SEARCH, RECIPE_SEARCH_RRF_K } from '../../../common/constants';
import { createPrismaMock, PrismaMock } from '../../../test/prisma-mock';
import { HybridSearchParams, RecipeSearchRepository } from './recipe-search.repository';

/** The SQL text and values of the n-th call of a raw query mock. */
const sqlOf = (mock: jest.Mock, call = 0): { sql: string; values: unknown[] } => {
  const [strings, ...values] = mock.mock.calls[call] as [TemplateStringsArray, ...unknown[]];
  const query = Prisma.sql(strings, ...values);
  return { sql: query.sql.replace(/\s+/g, ' '), values: query.values };
};

describe('RecipeSearchRepository', () => {
  let prisma: PrismaMock;
  let repository: RecipeSearchRepository;
  const params: HybridSearchParams = {
    model: 'm@3',
    embedding: [0.1, 0.2, 0.3],
    text: 'salmon dinner',
    filters: {},
    candidates: 50,
    limit: 10,
    weights: { semantic: 1, lexical: 1 },
  };

  beforeEach(() => {
    prisma = createPrismaMock();
    prisma.$executeRaw = jest.fn().mockResolvedValue(0) as never;
    repository = new RecipeSearchRepository(prisma);
  });

  describe('search', () => {
    beforeEach(() => {
      prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          recipeId: 'r',
          score: 0.03,
          semanticRank: 1,
          lexicalRank: 2,
          similarity: 0.7,
          allWords: true,
        },
      ]);
    });

    it('sets an iterative HNSW scan for the transaction, then fuses both legs by RRF', async () => {
      await expect(repository.search(params)).resolves.toEqual([
        {
          recipeId: 'r',
          score: 0.03,
          semanticRank: 1,
          lexicalRank: 2,
          similarity: 0.7,
          allWords: true,
        },
      ]);

      expect(prisma.$transaction).toHaveBeenCalled();
      const settings = sqlOf(prisma.$queryRaw, 0);
      expect(settings.sql).toContain("set_config('hnsw.iterative_scan', 'relaxed_order', true)");
      expect(settings.values).toEqual([String(RECIPE_SEARCH_EF_SEARCH)]);

      const { sql, values } = sqlOf(prisma.$queryRaw, 1);
      expect(sql).toContain('FROM recipe_embeddings e');
      expect(sql).toContain('e.embedding <=> $');
      expect(sql).toContain('replace(plainto_tsquery(');
      expect(sql).toContain('FULL OUTER JOIN lexical l');
      expect(values).toEqual(
        expect.arrayContaining([
          '[0.1,0.2,0.3]',
          'm@3',
          'salmon dinner',
          50,
          10,
          RECIPE_SEARCH_RRF_K,
        ]),
      );
    });

    it('leaves out the semantic leg without an embedding and the full-text leg without text', async () => {
      await repository.search({ ...params, embedding: null });
      expect(sqlOf(prisma.$queryRaw, 1).sql).not.toContain('recipe_embeddings');

      prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      await repository.search({ ...params, text: null });
      expect(sqlOf(prisma.$queryRaw, 3).sql).not.toContain('plainto_tsquery');
    });

    it('applies every filter to the recipe in both legs', async () => {
      await repository.search({
        ...params,
        filters: {
          mealType: 'dinner',
          dietTypeGroups: [['vegan', 'vegetarian'], []],
          excludeAllergens: ['peanut'],
          maxPrepTimeMinutes: 30,
          excludeRecipeIds: ['x'],
        },
      });

      const { sql, values } = sqlOf(prisma.$queryRaw, 1);
      for (const condition of [
        'r.meal_type = $',
        'r.diet_type && $',
        'NOT (r.allergens && $',
        'r.prep_time_minutes <= $',
        'r.id <> ALL($',
      ]) {
        expect(sql.split(condition)).toHaveLength(3);
      }
      expect(values).toEqual(
        expect.arrayContaining(['dinner', ['vegan', 'vegetarian'], ['peanut'], 30, ['x']]),
      );
    });
  });

  it('upserts documents with their tsvector, and nothing for none', async () => {
    await repository.upsertDocuments([]);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();

    await repository.upsertDocuments([
      { recipeId: 'r', documentVersion: 1, content: 'Salmon', contentHash: 'h' },
    ]);
    const { sql, values } = sqlOf(prisma.$executeRaw as unknown as jest.Mock);
    expect(sql).toContain('INSERT INTO recipe_search_documents');
    expect(sql).toContain('to_tsvector(');
    expect(sql).toContain('ON CONFLICT (recipe_id) DO UPDATE');
    expect(values).toEqual(['r', 1, 'Salmon', 'h', 'english', 'Salmon']);
  });

  it('upserts embeddings of a model as vector literals', async () => {
    await repository.upsertEmbeddings('m', []);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();

    await repository.upsertEmbeddings('m', [
      { recipeId: 'r', contentHash: 'h', embedding: [1, 0] },
    ]);
    const { sql, values } = sqlOf(prisma.$executeRaw as unknown as jest.Mock);
    expect(sql).toContain('ON CONFLICT (recipe_id, model) DO UPDATE');
    expect(values).toEqual(['r', 'm', 'h', '[1,0]']);
  });

  it('reads the index state and status of a model', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ recipes: 3, embedded: 2 }]);

    await expect(repository.findIndexState('m')).resolves.toEqual([]);
    await expect(repository.getIndexStatus('m')).resolves.toEqual({ recipes: 3, embedded: 2 });
    expect(sqlOf(prisma.$queryRaw, 0).values).toEqual(['m']);
    expect(sqlOf(prisma.$queryRaw, 1).sql).toContain('d.content_hash = e.content_hash');
  });

  it('deletes the vectors of the other models', async () => {
    (prisma.$executeRaw as unknown as jest.Mock).mockResolvedValue(4);

    await expect(repository.deleteEmbeddingsExcept(['m', 'n'])).resolves.toBe(4);
    const { sql, values } = sqlOf(prisma.$executeRaw as unknown as jest.Mock);
    expect(sql).toContain('model <> ALL(');
    expect(values).toEqual([['m', 'n']]);
  });
});
