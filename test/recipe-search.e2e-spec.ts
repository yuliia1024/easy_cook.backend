import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Allergen, FoodSource, FoodState, RecipeSearchMode } from '../src/common/constants';
import { EmbeddingUnavailableException } from '../src/common/exceptions';
import { ConfigModule } from '../src/configs/config.module';
import { RecipeIndexService } from '../src/modules/services/recipe-search/recipe-index.service';
import { RecipeSearchModule } from '../src/modules/services/recipe-search/recipe-search.module';
import { RecipeSearchService } from '../src/modules/services/recipe-search/recipe-search.service';
import { EmbeddingService } from '../src/providers/embedding/embedding.service';
import { PrismaModule } from '../src/providers/prisma/prisma.module';
import { PrismaService } from '../src/providers/prisma/prisma.service';
import { createFakeEmbeddingService } from '../src/test/fake-embeddings';
import { resetDatabase } from './test-app';

/**
 * The hybrid search SQL on a real Postgres with pgvector: the embedding model is the deterministic
 * `fakeEmbedding` (no model, no network), so the ranking below follows the shared words.
 */
describe('recipe search (e2e)', () => {
  let prisma: PrismaService;
  let index: RecipeIndexService;
  let search: RecipeSearchService;
  let embeddings: jest.Mocked<EmbeddingService>;
  let close: () => Promise<void>;

  const names = async (...args: Parameters<RecipeSearchService['search']>): Promise<string[]> =>
    (await search.search(...args)).hits.map(({ recipe }) => recipe.name);

  const createRecipe = async (
    name: string,
    food: string,
    data: { mealType: string; dietType?: string[]; allergens?: string[]; prepTimeMinutes?: number },
  ): Promise<string> => {
    const foodItem = await prisma.foodItem.create({
      data: { name: food, state: FoodState.Raw, source: FoodSource.Manual, kcalPer100g: 100 },
    });
    const recipe = await prisma.recipe.create({
      data: {
        name,
        instructions: `Cook the ${food.toLowerCase()}.`,
        servings: 2,
        source: 'manual',
        ...data,
        ingredients: { create: [{ foodItemId: foodItem.id, quantityG: 200 }] },
      },
    });
    return recipe.id;
  };

  beforeAll(async () => {
    Logger.overrideLogger(false);
    embeddings = createFakeEmbeddingService();
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, PrismaModule, RecipeSearchModule],
    })
      .overrideProvider(EmbeddingService)
      .useValue(embeddings)
      .compile();
    const app = await moduleRef.init();
    prisma = app.get(PrismaService);
    index = app.get(RecipeIndexService);
    search = app.get(RecipeSearchService);
    close = () => app.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    jest.clearAllMocks();
    await createRecipe('Baked salmon with rice', 'Salmon', {
      mealType: 'dinner',
      dietType: ['pescatarian'],
      allergens: [Allergen.Fish],
      prepTimeMinutes: 30,
    });
    await createRecipe('Buckwheat porridge with milk', 'Buckwheat', {
      mealType: 'breakfast',
      dietType: ['vegetarian'],
      allergens: [Allergen.Milk],
      prepTimeMinutes: 20,
    });
    await createRecipe('Tofu stir-fry with vegetables', 'Tofu', {
      mealType: 'dinner',
      dietType: ['vegan'],
      allergens: [Allergen.Soy],
      prepTimeMinutes: 25,
    });
    await createRecipe('Chicken soup with noodles', 'Chicken', {
      mealType: 'lunch',
      prepTimeMinutes: 60,
    });
    await index.sync();
  });

  afterAll(async () => {
    await close();
  });

  it('keeps the HNSW index the migration created: a new migration must not drop it', async () => {
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'recipe_embeddings_embedding_hnsw_idx'`;

    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain('USING hnsw (embedding vector_cosine_ops)');
  });

  it('indexes every recipe and then only what changed', async () => {
    await expect(index.status()).resolves.toEqual([
      expect.objectContaining({ recipes: 4, embedded: 4, complete: true }),
    ]);
    await expect(index.sync()).resolves.toMatchObject({
      documentsWritten: 0,
      models: [{ embedded: 0 }],
    });

    await prisma.recipe.updateMany({
      where: { name: 'Chicken soup with noodles' },
      data: { name: 'Chicken broth with noodles' },
    });
    // `status` compares the stored hashes; a changed recipe shows up once `sync` builds its document.
    await expect(index.sync()).resolves.toMatchObject({
      documentsWritten: 1,
      models: [{ embedded: 1 }],
    });
    await expect(index.status()).resolves.toEqual([expect.objectContaining({ complete: true })]);
  });

  it('ranks by both legs, the best match first', async () => {
    const result = await search.search({ text: 'salmon dinner' });

    expect(result.hits[0]).toMatchObject({
      recipe: expect.objectContaining({ name: 'Baked salmon with rice' }),
      semanticRank: 1,
      lexicalRank: 1,
    });
    expect(result.hits[0].similarity).toBeGreaterThan(result.hits[1].similarity ?? -1);
    expect(result).toMatchObject({ mode: RecipeSearchMode.Hybrid, degraded: false });
  });

  it('finds by an ingredient that only the document names', async () => {
    await expect(names({ text: 'buckwheat', mode: RecipeSearchMode.Lexical })).resolves.toEqual([
      'Buckwheat porridge with milk',
    ]);
  });

  it('applies the filters before ranking, in both legs', async () => {
    await expect(names({ text: 'salmon', filters: { mealType: 'breakfast' } })).resolves.toEqual([
      'Buckwheat porridge with milk',
    ]);
    await expect(
      names({ text: 'salmon dinner', filters: { excludeAllergens: [Allergen.Fish] } }),
    ).resolves.not.toContain('Baked salmon with rice');
    await expect(
      names({ text: 'dinner', filters: { dietTypeGroups: [['vegan', 'vegetarian']] } }),
    ).resolves.toEqual(expect.arrayContaining(['Tofu stir-fry with vegetables']));
    await expect(
      names({ text: 'chicken soup', filters: { maxPrepTimeMinutes: 30 } }),
    ).resolves.not.toContain('Chicken soup with noodles');
  });

  it('runs the semantic leg alone', async () => {
    const result = await search.search({ text: 'tofu', mode: RecipeSearchMode.Semantic, limit: 2 });

    expect(result.hits).toHaveLength(2);
    expect(result.hits[0].recipe.name).toBe('Tofu stir-fry with vegetables');
    expect(result.hits.every(({ lexicalRank }) => lexicalRank === null)).toBe(true);
  });

  it('falls back to full-text when no embedding provider answers', async () => {
    embeddings.embedQuery.mockRejectedValueOnce(new EmbeddingUnavailableException());

    const result = await search.search({ text: 'buckwheat' });

    expect(result).toMatchObject({ mode: RecipeSearchMode.Lexical, degraded: true });
    expect(result.hits.map(({ recipe }) => recipe.name)).toEqual(['Buckwheat porridge with milk']);
  });

  it('drops the index rows with the recipe', async () => {
    await prisma.recipe.deleteMany({ where: { name: 'Baked salmon with rice' } });

    await expect(index.status()).resolves.toEqual([
      expect.objectContaining({ recipes: 3, embedded: 3 }),
    ]);
  });
});
