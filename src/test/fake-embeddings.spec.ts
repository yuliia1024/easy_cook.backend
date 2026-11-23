import { EMBEDDING_DIMENSIONS } from '../common/constants';
import { createFakeEmbeddingService, fakeEmbedding } from './fake-embeddings';

const cosine = (a: number[], b: number[]): number => a.reduce((sum, v, i) => sum + v * b[i], 0);

describe('fakeEmbedding', () => {
  it('is a unit vector of the column size', () => {
    const vector = fakeEmbedding('salmon with rice');

    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(Math.hypot(...vector)).toBeCloseTo(1);
  });

  it('is deterministic and puts texts that share words closer', () => {
    const query = fakeEmbedding('salmon dinner');

    expect(fakeEmbedding('salmon dinner')).toEqual(query);
    expect(cosine(query, fakeEmbedding('baked salmon with rice'))).toBeGreaterThan(
      cosine(query, fakeEmbedding('oatmeal with banana')),
    );
  });

  it('gives an empty text a valid vector', () => {
    expect(Math.hypot(...fakeEmbedding(''))).toBe(1);
  });
});

describe('createFakeEmbeddingService', () => {
  it('embeds with fakeEmbedding under the local model key', async () => {
    const service = createFakeEmbeddingService();

    expect(service.modelKeys).toEqual(['ollama/qwen3-embedding:0.6b-q8_0@1024']);
    await expect(service.embedQuery('soup')).resolves.toEqual({
      vector: fakeEmbedding('soup'),
      modelKey: 'ollama/qwen3-embedding:0.6b-q8_0@1024',
    });
    await expect(service.embedDocuments('any', ['a', 'b'])).resolves.toEqual({
      embeddings: [fakeEmbedding('a'), fakeEmbedding('b')],
      tokens: 2,
    });
  });
});
