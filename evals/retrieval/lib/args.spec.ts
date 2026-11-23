import { EmbeddingProviderName, RecipeSearchMode } from '../../../src/common/constants';
import { parseRetrievalArgs } from './args';

describe('parseRetrievalArgs', () => {
  it('measures the local model in every mode by default', () => {
    expect(parseRetrievalArgs([])).toEqual({
      provider: EmbeddingProviderName.Ollama,
      modes: [RecipeSearchMode.Hybrid, RecipeSearchMode.Semantic, RecipeSearchMode.Lexical],
      tags: [],
      saveBaseline: false,
    });
  });

  it('reads the provider, modes, tags and --save-baseline', () => {
    expect(
      parseRetrievalArgs([
        '--provider',
        'openai',
        '--mode',
        'hybrid, semantic',
        '--tag',
        'uk',
        '--tag',
        'filters,uk',
        '--save-baseline',
      ]),
    ).toEqual({
      provider: EmbeddingProviderName.OpenAi,
      modes: [RecipeSearchMode.Hybrid, RecipeSearchMode.Semantic],
      tags: ['uk', 'filters'],
      saveBaseline: true,
    });
  });

  it('rejects an unknown provider, mode or flag', () => {
    expect(() => parseRetrievalArgs(['--provider', 'cohere'])).toThrow('--provider must be one of');
    expect(() => parseRetrievalArgs(['--mode', 'fuzzy'])).toThrow('--mode must be one of');
    expect(() => parseRetrievalArgs(['--repeat', '3'])).toThrow();
  });
});
