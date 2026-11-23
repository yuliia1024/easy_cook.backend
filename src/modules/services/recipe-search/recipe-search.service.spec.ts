import { Logger } from '@nestjs/common';
import {
  RECIPE_SEARCH_CANDIDATES,
  RECIPE_SEARCH_DEFAULT_LIMIT,
  RECIPE_SEARCH_MAX_LIMIT,
  RECIPE_SEARCH_QUERY_MAX_LENGTH,
  RECIPE_SEARCH_WEIGHTS,
  RecipeSearchMode,
} from '../../../common/constants';
import {
  EmbeddingDimensionsMismatchException,
  EmbeddingUnavailableException,
} from '../../../common/exceptions';
import { EmbeddingService } from '../../../providers/embedding/embedding.service';
import { createMock } from '../../../test/create-mock';
import {
  createFakeEmbeddingService,
  FAKE_EMBEDDING_MODEL_KEY as MODEL,
  fakeEmbedding,
} from '../../../test/fake-embeddings';
import { buildRecipe } from '../../../test/fixtures';
import { RecipeSearchRepository } from '../../data-access/recipe-search/recipe-search.repository';
import { RecipeRepository } from '../../data-access/recipe/recipe.repository';
import { fullTextQuery, RecipeSearchService } from './recipe-search.service';

const row = (recipeId: string, score: number, similarity = 0.8, allWords = false) => ({
  recipeId,
  score,
  semanticRank: 1,
  lexicalRank: null,
  similarity,
  allWords,
});

describe('RecipeSearchService', () => {
  let search: jest.Mocked<RecipeSearchRepository>;
  let recipes: jest.Mocked<RecipeRepository>;
  let embeddings: jest.Mocked<EmbeddingService>;
  let service: RecipeSearchService;

  const salmon = buildRecipe({ id: 'salmon', name: 'Salmon' });
  const trout = buildRecipe({ id: 'trout', name: 'Trout' });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    search = createMock<RecipeSearchRepository>();
    recipes = createMock<RecipeRepository>();
    embeddings = createFakeEmbeddingService();
    service = new RecipeSearchService(search, recipes, embeddings);
    search.search.mockResolvedValue([row('trout', 0.03), row('salmon', 0.02)]);
    // The repository loads in no particular order.
    recipes.findByIds.mockResolvedValue([salmon, trout]);
  });

  it('runs both legs with the query vector and keeps the rank order', async () => {
    const filters = { mealType: 'dinner', excludeAllergens: ['peanut'] };

    const result = await service.search({ text: '  fish for dinner ', filters });

    expect(embeddings.embedQuery).toHaveBeenCalledWith('fish for dinner', undefined);
    expect(search.search).toHaveBeenCalledWith({
      model: MODEL,
      embedding: fakeEmbedding('fish for dinner'),
      text: 'fish for dinner',
      filters,
      candidates: RECIPE_SEARCH_CANDIDATES,
      limit: RECIPE_SEARCH_DEFAULT_LIMIT,
      weights: RECIPE_SEARCH_WEIGHTS,
    });
    expect(result.hits.map(({ recipe }) => recipe.id)).toEqual(['trout', 'salmon']);
    expect(result.hits[0]).toEqual({
      recipe: trout,
      score: 0.03,
      semanticRank: 1,
      lexicalRank: null,
      similarity: 0.8,
      allWords: false,
      match: true,
    });
    expect(result).toMatchObject({
      mode: RecipeSearchMode.Hybrid,
      degraded: false,
      model: MODEL,
      matched: true,
    });
  });

  it('searches the vectors of the model that embedded the query: the fallback has its own', async () => {
    embeddings.embedQuery.mockResolvedValue({
      vector: [1],
      modelKey: 'openai/text-embedding-3-large@1024',
    });

    const result = await service.search({ text: 'fish' });

    expect(search.search).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'openai/text-embedding-3-large@1024', embedding: [1] }),
    );
    expect(result.model).toBe('openai/text-embedding-3-large@1024');
  });

  it('runs the semantic leg alone, or the full-text leg alone without embedding', async () => {
    await service.search({ text: 'fish', mode: RecipeSearchMode.Semantic });
    expect(search.search).toHaveBeenLastCalledWith(expect.objectContaining({ text: null }));

    await service.search({ text: 'fish', mode: RecipeSearchMode.Lexical });
    expect(search.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ embedding: null, text: 'fish' }),
    );
    expect(embeddings.embedQuery).toHaveBeenCalledTimes(1);
  });

  it('clamps the limit and asks each leg for at least the limit', async () => {
    await service.search({ text: 'fish', limit: 1000 });
    expect(search.search).toHaveBeenLastCalledWith(
      expect.objectContaining({
        limit: RECIPE_SEARCH_MAX_LIMIT,
        candidates: RECIPE_SEARCH_MAX_LIMIT,
      }),
    );

    await service.search({ text: 'fish', limit: 0 });
    expect(search.search).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 1 }));
  });

  it('full-text searches only the words of three letters or more', async () => {
    await service.search({ text: 'лосось на вечерю, з рисом' });
    expect(search.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: 'лосось вечерю рисом' }),
    );

    await service.search({ text: 'a la' });
    expect(search.search).toHaveBeenLastCalledWith(expect.objectContaining({ text: null }));
    expect(fullTextQuery('Chicken, 2 eggs')).toBe('Chicken eggs');
  });

  describe('matched', () => {
    const calibrated = (threshold: number | null): void => {
      Object.defineProperty(embeddings, 'models', {
        value: embeddings.models.map((model) => ({ ...model, matchSimilarity: threshold })),
      });
    };

    it('matches when the best recipe reaches the similarity of the model', async () => {
      calibrated(0.5);
      search.search.mockResolvedValue([row('trout', 0.03, 0.62), row('salmon', 0.02, 0.4)]);

      await expect(service.search({ text: 'trout' })).resolves.toMatchObject({ matched: true });
    });

    it('finds only similar recipes below it, unless one has every word of the query', async () => {
      calibrated(0.5);
      search.search.mockResolvedValue([row('trout', 0.03, 0.46), row('salmon', 0.02, 0.44)]);
      await expect(service.search({ text: 'sushi' })).resolves.toMatchObject({ matched: false });

      search.search.mockResolvedValue([row('trout', 0.03, 0.46), row('salmon', 0.02, 0.44, true)]);
      const { matched, hits } = await service.search({ text: 'salmon' });
      expect(matched).toBe(true);
      expect(hits.map(({ recipe, match }) => [recipe.id, match])).toEqual([
        ['trout', false],
        ['salmon', true],
      ]);
    });

    it('matches any hit of a model not calibrated, and nothing without hits', async () => {
      calibrated(null);
      search.search.mockResolvedValue([row('trout', 0.03, 0.1)]);
      await expect(service.search({ text: 'trout' })).resolves.toMatchObject({ matched: true });

      search.search.mockResolvedValue([]);
      await expect(service.search({ text: 'trout' })).resolves.toMatchObject({ matched: false });
    });

    it('matches a full-text search only by every word of the query', async () => {
      search.search.mockResolvedValue([
        { ...row('trout', 0.03), similarity: null },
        { ...row('salmon', 0.02), similarity: null },
      ]);
      await expect(
        service.search({ text: 'trout', mode: RecipeSearchMode.Lexical }),
      ).resolves.toMatchObject({ matched: false });

      search.search.mockResolvedValue([{ ...row('trout', 0.03, 0, true), similarity: null }]);
      await expect(
        service.search({ text: 'trout', mode: RecipeSearchMode.Lexical }),
      ).resolves.toMatchObject({ matched: true });
    });
  });

  it('cuts a long query', async () => {
    await service.search({ text: 'a'.repeat(RECIPE_SEARCH_QUERY_MAX_LENGTH + 10) });

    expect(embeddings.embedQuery).toHaveBeenCalledWith(
      'a'.repeat(RECIPE_SEARCH_QUERY_MAX_LENGTH),
      undefined,
    );
  });

  it('finds nothing for a blank query without calling anything', async () => {
    await expect(service.search({ text: '   ' })).resolves.toMatchObject({ hits: [] });
    expect(embeddings.embedQuery).not.toHaveBeenCalled();
    expect(search.search).not.toHaveBeenCalled();
  });

  it('leaves out a recipe deleted between the two queries', async () => {
    recipes.findByIds.mockResolvedValue([salmon]);

    const { hits } = await service.search({ text: 'fish' });

    expect(hits.map(({ recipe }) => recipe.id)).toEqual(['salmon']);
  });

  it('falls back to full-text when the embedding model is down', async () => {
    embeddings.embedQuery.mockRejectedValue(new EmbeddingUnavailableException());

    const result = await service.search({ text: 'fish' });

    expect(search.search).toHaveBeenCalledWith(
      expect.objectContaining({ embedding: null, text: 'fish' }),
    );
    expect(result).toMatchObject({ mode: RecipeSearchMode.Lexical, degraded: true, model: null });
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('searches every set of filters with one embedding of the query', async () => {
    const results = await service.searchEach({ text: 'fish' }, [
      { mealType: 'lunch' },
      { mealType: 'dinner' },
    ]);

    expect(embeddings.embedQuery).toHaveBeenCalledTimes(1);
    expect(search.search).toHaveBeenCalledTimes(2);
    expect(search.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ filters: { mealType: 'dinner' } }),
    );
    expect(results).toHaveLength(2);
  });

  it('fails instead of falling back to full-text when the client went away', async () => {
    const abort = new AbortController();
    abort.abort();
    embeddings.embedQuery.mockRejectedValue(new EmbeddingUnavailableException());

    await expect(service.search({ text: 'fish' }, abort.signal)).rejects.toThrow(
      EmbeddingUnavailableException,
    );
    expect(search.search).not.toHaveBeenCalled();
    expect(Logger.prototype.warn).not.toHaveBeenCalled();
  });

  it('fails a semantic search, and any search on a wrong model, when embedding fails', async () => {
    embeddings.embedQuery.mockRejectedValue(new EmbeddingUnavailableException());
    await expect(service.search({ text: 'fish', mode: RecipeSearchMode.Semantic })).rejects.toThrow(
      EmbeddingUnavailableException,
    );

    embeddings.embedQuery.mockRejectedValue(new EmbeddingDimensionsMismatchException(1024, 768));
    await expect(service.search({ text: 'fish' })).rejects.toThrow(
      EmbeddingDimensionsMismatchException,
    );
  });

  it('logs counts and timings, never the query', async () => {
    await service.search({ text: 'my secret craving', filters: { mealType: 'lunch' } });

    const line = (Logger.prototype.log as jest.Mock).mock.calls.at(-1)[0] as string;
    expect(line).toMatch(
      /^recipe search mode=hybrid filters=1 hits=2 matched=true embedding_ms=\d+ db_ms=\d+ ms=\d+$/,
    );
    expect(line).not.toContain('secret');
  });
});
