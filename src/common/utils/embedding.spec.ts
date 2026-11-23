import { EmbeddingProviderName } from '../constants';
import { embeddingModelKey, toVectorLiteral } from './embedding';

describe('embeddingModelKey', () => {
  it('names the provider, the model and the dimensions', () => {
    expect(
      embeddingModelKey({
        provider: EmbeddingProviderName.OpenAi,
        id: 'text-embedding-3-large',
        dimensions: 1024,
        queryPrefix: '',
        matchSimilarity: null,
      }),
    ).toBe('openai/text-embedding-3-large@1024');
  });
});

describe('toVectorLiteral', () => {
  it('writes the pgvector text form', () => {
    expect(toVectorLiteral([0.5, -1, 2e-7])).toBe('[0.5,-1,2e-7]');
  });

  it.each([[[]], [[1, Number.NaN]], [[Number.POSITIVE_INFINITY]]])('rejects %p', (vector) => {
    expect(() => toVectorLiteral(vector)).toThrow('non-empty and finite');
  });
});
