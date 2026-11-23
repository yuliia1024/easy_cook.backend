/**
 * Ranking metrics of one query. `ranked` is the returned order (ids), `relevance` the graded
 * judgements of the case: 2 - exactly what was asked, 1 - fits; an id without a grade is not
 * relevant. Every metric is in [0, 1].
 */
export type Relevance = Readonly<Record<string, number>>;

const relevantIds = (relevance: Relevance): string[] =>
  Object.keys(relevance).filter((id) => relevance[id] > 0);

/** Share of the relevant recipes found in the top k. */
export function recallAtK(ranked: string[], relevance: Relevance, k: number): number {
  const relevant = relevantIds(relevance);
  if (relevant.length === 0) {
    return 0;
  }
  const top = new Set(ranked.slice(0, k));
  return relevant.filter((id) => top.has(id)).length / relevant.length;
}

/** Share of the top k that is relevant; a shorter list counts its missing places as misses. */
export function precisionAtK(ranked: string[], relevance: Relevance, k: number): number {
  return ranked.slice(0, k).filter((id) => (relevance[id] ?? 0) > 0).length / k;
}

/** 1 when any relevant recipe is in the top k. */
export function hitAtK(ranked: string[], relevance: Relevance, k: number): number {
  return ranked.slice(0, k).some((id) => (relevance[id] ?? 0) > 0) ? 1 : 0;
}

/** 1 / rank of the first relevant recipe in the top k, 0 without one. */
export function reciprocalRankAtK(ranked: string[], relevance: Relevance, k: number): number {
  const index = ranked.slice(0, k).findIndex((id) => (relevance[id] ?? 0) > 0);
  return index === -1 ? 0 : 1 / (index + 1);
}

const dcg = (grades: number[]): number =>
  grades.reduce((sum, grade, i) => sum + (2 ** grade - 1) / Math.log2(i + 2), 0);

/** Normalised DCG with gain 2^grade - 1: a grade-2 recipe above a grade-1 one scores higher. */
export function ndcgAtK(ranked: string[], relevance: Relevance, k: number): number {
  const ideal = dcg(
    Object.values(relevance)
      .filter((grade) => grade > 0)
      .sort((a, b) => b - a)
      .slice(0, k),
  );
  if (ideal === 0) {
    return 0;
  }
  return dcg(ranked.slice(0, k).map((id) => relevance[id] ?? 0)) / ideal;
}
