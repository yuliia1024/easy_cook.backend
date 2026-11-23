import { Logger } from '@nestjs/common';
import { EMBEDDING_BATCH_SIZE } from '../../../common/constants';
import { EmbeddingUnavailableException } from '../../../common/exceptions';
import { EmbeddingService } from '../../../providers/embedding/embedding.service';
import { createMock } from '../../../test/create-mock';
import {
  createFakeEmbeddingService,
  FAKE_EMBEDDING_MODEL_KEY as LOCAL,
  fakeEmbedding,
} from '../../../test/fake-embeddings';
import { buildRecipe } from '../../../test/fixtures';
import { RecipeSearchRepository } from '../../data-access/recipe-search/recipe-search.repository';
import { RecipeRepository } from '../../data-access/recipe/recipe.repository';
import { buildRecipeDocument } from './recipe-document';
import { RecipeIndexService } from './recipe-index.service';

const OPENAI = 'openai/text-embedding-3-large@1024';

describe('RecipeIndexService', () => {
  let recipes: jest.Mocked<RecipeRepository>;
  let search: jest.Mocked<RecipeSearchRepository>;
  let embeddings: jest.Mocked<EmbeddingService>;
  let service: RecipeIndexService;

  const recipeA = buildRecipe({ id: 'a', name: 'Salmon with rice' });
  const recipeB = buildRecipe({ id: 'b', name: 'Oatmeal' });
  const docA = buildRecipeDocument(recipeA);
  const docB = buildRecipeDocument(recipeB);
  const inStep = [docA, docB].map((doc) => ({
    recipeId: doc.recipeId,
    documentHash: doc.contentHash,
    embeddingHash: doc.contentHash,
  }));
  const manyRecipes = (): ReturnType<typeof buildRecipe>[] =>
    Array.from({ length: EMBEDDING_BATCH_SIZE + 1 }, (_, i) =>
      buildRecipe({ id: `r${i}`, name: `Recipe ${i}` }),
    );

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    recipes = createMock<RecipeRepository>();
    search = createMock<RecipeSearchRepository>();
    embeddings = createFakeEmbeddingService();
    service = new RecipeIndexService(recipes, search, embeddings);
    recipes.findAll.mockResolvedValue([recipeA, recipeB]);
    search.findIndexState.mockResolvedValue([]);
  });

  it('writes and embeds every recipe of an empty index under the model key', async () => {
    const result = await service.sync();

    expect(search.findIndexState).toHaveBeenCalledWith(LOCAL);
    expect(search.upsertDocuments).toHaveBeenCalledWith([docA, docB]);
    expect(embeddings.embedDocuments).toHaveBeenCalledWith(LOCAL, [docA.content, docB.content]);
    expect(search.upsertEmbeddings).toHaveBeenCalledWith(LOCAL, [
      { recipeId: 'a', contentHash: docA.contentHash, embedding: fakeEmbedding(docA.content) },
      { recipeId: 'b', contentHash: docB.contentHash, embedding: fakeEmbedding(docB.content) },
    ]);
    expect(result).toEqual({
      recipes: 2,
      documentsWritten: 2,
      models: [{ model: LOCAL, embedded: 2, tokens: 2, error: null }],
      durationMs: expect.any(Number),
    });
  });

  it('touches only what changed: a new document, a missing or stale embedding', async () => {
    search.findIndexState.mockResolvedValue([
      inStep[0],
      { recipeId: 'b', documentHash: docB.contentHash, embeddingHash: 'old' },
    ]);

    const result = await service.sync();

    expect(search.upsertDocuments).not.toHaveBeenCalled();
    expect(embeddings.embedDocuments).toHaveBeenCalledWith(LOCAL, [docB.content]);
    expect(result).toMatchObject({ documentsWritten: 0, models: [{ embedded: 1 }] });
  });

  it('does nothing on an index in step, and rebuilds everything when forced', async () => {
    search.findIndexState.mockResolvedValue(inStep);

    await expect(service.sync()).resolves.toMatchObject({
      documentsWritten: 0,
      models: [{ embedded: 0 }],
    });
    expect(embeddings.embedDocuments).not.toHaveBeenCalled();

    await expect(service.sync({ force: true })).resolves.toMatchObject({
      documentsWritten: 2,
      models: [{ embedded: 2 }],
    });
  });

  describe('with a fallback model', () => {
    beforeEach(() => {
      Object.assign(embeddings, { modelKeys: [LOCAL, OPENAI] });
    });

    it('fills an index per model and writes the documents once', async () => {
      const result = await service.sync();

      expect(search.findIndexState).toHaveBeenCalledWith(OPENAI);
      expect(search.upsertDocuments).toHaveBeenCalledTimes(1);
      expect(embeddings.embedDocuments).toHaveBeenCalledWith(OPENAI, [docA.content, docB.content]);
      expect(result.models.map(({ model, embedded }) => [model, embedded])).toEqual([
        [LOCAL, 2],
        [OPENAI, 2],
      ]);
    });

    it('skips the model whose provider is down and fills the other', async () => {
      embeddings.embedDocuments.mockImplementation((model, texts) =>
        model === LOCAL
          ? Promise.reject(new EmbeddingUnavailableException())
          : Promise.resolve({ embeddings: texts.map(() => [1]), tokens: 1 }),
      );

      const result = await service.sync();

      expect(result.models).toEqual([
        { model: LOCAL, embedded: 0, tokens: 0, error: 'Embedding model is unavailable' },
        { model: OPENAI, embedded: 2, tokens: 1, error: null },
      ]);
    });

    it('writes the documents and warns when no model could be indexed', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      embeddings.embedDocuments.mockRejectedValue(new EmbeddingUnavailableException());

      const result = await service.sync();

      expect(search.upsertDocuments).toHaveBeenCalled();
      expect(result.models.every(({ error }) => error !== null)).toBe(true);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('runs on full text'));
      warn.mockRestore();
    });
  });

  it('embeds in batches, saving and reporting each one', async () => {
    recipes.findAll.mockResolvedValue(manyRecipes());
    const onProgress = jest.fn();

    await service.sync({ onProgress });

    expect(embeddings.embedDocuments).toHaveBeenCalledTimes(2);
    expect(search.upsertEmbeddings).toHaveBeenCalledTimes(2);
    expect(onProgress.mock.calls).toEqual([
      [LOCAL, EMBEDDING_BATCH_SIZE, EMBEDDING_BATCH_SIZE + 1],
      [LOCAL, EMBEDDING_BATCH_SIZE + 1, EMBEDDING_BATCH_SIZE + 1],
    ]);
  });

  it('keeps the batches saved before a failed one', async () => {
    recipes.findAll.mockResolvedValue(manyRecipes());
    embeddings.embedDocuments
      .mockResolvedValueOnce({ embeddings: new Array(EMBEDDING_BATCH_SIZE).fill([1]), tokens: 1 })
      .mockRejectedValueOnce(new EmbeddingUnavailableException());

    const result = await service.sync();

    expect(result.models[0].error).toBe('Embedding model is unavailable');
    expect(search.upsertEmbeddings).toHaveBeenCalledTimes(1);
  });

  it('reports per model whether every recipe is embedded from its current document', async () => {
    search.getIndexStatus.mockResolvedValue({ recipes: 3, embedded: 2 });

    await expect(service.status()).resolves.toEqual([
      { model: LOCAL, recipes: 3, embedded: 2, complete: false },
    ]);
  });

  it('prunes the vectors of the models no longer configured', async () => {
    search.deleteEmbeddingsExcept.mockResolvedValue(5);

    await expect(service.pruneOtherModels()).resolves.toBe(5);
    expect(search.deleteEmbeddingsExcept).toHaveBeenCalledWith([LOCAL]);
  });
});
