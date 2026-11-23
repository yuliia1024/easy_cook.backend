import { EmbeddingModelSpec } from '../types';

/** `provider/model@dimensions`: stored with every vector, so vectors of two models never meet. */
export const embeddingModelKey = ({ provider, id, dimensions }: EmbeddingModelSpec): string =>
  `${provider}/${id}@${dimensions}`;

/** A pgvector literal (`[0.1,0.2]`), the text form `::vector` casts from. */
export function toVectorLiteral(vector: readonly number[]): string {
  if (vector.length === 0 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error('A vector must be non-empty and finite');
  }
  return `[${vector.join(',')}]`;
}
