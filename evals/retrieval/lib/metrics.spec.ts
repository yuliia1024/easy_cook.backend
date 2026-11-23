import { hitAtK, ndcgAtK, precisionAtK, recallAtK, reciprocalRankAtK } from './metrics';

describe('ranking metrics', () => {
  const relevance = { a: 2, b: 1, c: 1, x: 0 };

  it('recall@k: the share of the relevant ones in the top k', () => {
    expect(recallAtK(['a', 'z', 'b'], relevance, 3)).toBeCloseTo(2 / 3);
    expect(recallAtK(['z', 'a'], relevance, 1)).toBe(0);
    expect(recallAtK(['a'], {}, 5)).toBe(0);
  });

  it('precision@k counts the missing places as misses', () => {
    expect(precisionAtK(['a', 'z'], relevance, 4)).toBe(0.25);
    expect(precisionAtK(['a', 'b', 'x'], relevance, 3)).toBeCloseTo(2 / 3);
  });

  it('hit@k and reciprocal rank look for the first relevant one', () => {
    expect(hitAtK(['z', 'x', 'c'], relevance, 2)).toBe(0);
    expect(hitAtK(['z', 'x', 'c'], relevance, 3)).toBe(1);
    expect(reciprocalRankAtK(['z', 'x', 'c'], relevance, 10)).toBeCloseTo(1 / 3);
    expect(reciprocalRankAtK(['z'], relevance, 10)).toBe(0);
  });

  it('nDCG@k is 1 for the ideal order and rewards the higher grade first', () => {
    expect(ndcgAtK(['a', 'b', 'c'], relevance, 3)).toBeCloseTo(1);
    expect(ndcgAtK(['b', 'a', 'c'], relevance, 3)).toBeLessThan(1);
    expect(ndcgAtK(['b', 'a', 'c'], relevance, 3)).toBeGreaterThan(
      ndcgAtK(['z', 'b', 'a'], relevance, 3),
    );
    expect(ndcgAtK(['a'], {}, 3)).toBe(0);
  });

  it('nDCG@k of a known order', () => {
    // dcg = 1/log2(2) + 3/log2(3); ideal = 3/log2(2) + 1/log2(3)
    expect(ndcgAtK(['b', 'a'], { a: 2, b: 1 }, 2)).toBeCloseTo(
      (1 + 3 / Math.log2(3)) / (3 + 1 / Math.log2(3)),
    );
  });
});
