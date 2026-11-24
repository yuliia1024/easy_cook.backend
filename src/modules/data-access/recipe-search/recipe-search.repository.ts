import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import {
  RECIPE_SEARCH_EF_SEARCH,
  RECIPE_SEARCH_RANK_NORMALIZATION,
  RECIPE_SEARCH_RRF_K,
  RECIPE_SEARCH_TS_CONFIG,
} from '../../../common/constants';
import { RecipeSearchFilters, RecipeSearchRow } from '../../../common/types';
import { toVectorLiteral } from '../../../common/utils';
import { PrismaService } from '../../../providers/prisma/prisma.service';

export interface SearchDocumentData {
  recipeId: string;
  documentVersion: number;
  content: string;
  contentHash: string;
}

export interface EmbeddingData {
  recipeId: string;
  contentHash: string;
  embedding: number[];
}

/** The content hash of a recipe's document and of its embedding by one model; null when missing. */
export interface RecipeIndexState {
  recipeId: string;
  documentHash: string | null;
  embeddingHash: string | null;
}

export interface IndexStatus {
  recipes: number;
  /** Recipes whose embedding by the model is of their current document. */
  embedded: number;
}

/**
 * One search: a leg runs when its input is given (`embedding` - semantic, `text` - full-text),
 * each returns `candidates` recipes passing `filters`, and the two lists are fused by RRF.
 */
export interface HybridSearchParams {
  /** The model of `embedding`: only its vectors are compared. */
  model: string;
  embedding: number[] | null;
  text: string | null;
  filters: RecipeSearchFilters;
  candidates: number;
  limit: number;
  weights: { semantic: number; lexical: number };
}

const NO_LEG = Prisma.sql`SELECT NULL::uuid AS recipe_id, NULL::float8 AS distance, NULL::int AS rank, false AS all_words WHERE false`;

/**
 * The search tables (`recipe_search_documents`, `recipe_embeddings`) and the hybrid query. Writes
 * are upserts keyed by recipe (and model), so an indexing run can be repeated or resumed.
 */
@Injectable()
export class RecipeSearchRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Every recipe with the hashes of its document and of its embedding by `model`. */
  public async findIndexState(model: string): Promise<RecipeIndexState[]> {
    return this.prisma.$queryRaw<RecipeIndexState[]>`
      SELECT r.id AS "recipeId", d.content_hash AS "documentHash", e.content_hash AS "embeddingHash"
      FROM recipes r
      LEFT JOIN recipe_search_documents d ON d.recipe_id = r.id
      LEFT JOIN recipe_embeddings e ON e.recipe_id = r.id AND e.model = ${model}
      ORDER BY r.id`;
  }

  public async getIndexStatus(model: string): Promise<IndexStatus> {
    const [row] = await this.prisma.$queryRaw<IndexStatus[]>`
      SELECT
        (SELECT count(*) FROM recipes)::int AS recipes,
        (SELECT count(*) FROM recipe_embeddings e
           JOIN recipe_search_documents d ON d.recipe_id = e.recipe_id AND d.content_hash = e.content_hash
         WHERE e.model = ${model})::int AS embedded`;
    return row;
  }

  /** The tsvector is built here from the content, in the same statement. */
  public async upsertDocuments(documents: SearchDocumentData[]): Promise<void> {
    if (documents.length === 0) {
      return;
    }
    const rows = documents.map(
      (doc) =>
        Prisma.sql`(${doc.recipeId}::uuid, ${doc.documentVersion}, ${doc.content}, ${doc.contentHash},
          to_tsvector(${RECIPE_SEARCH_TS_CONFIG}::regconfig, ${doc.content}), now())`,
    );
    await this.prisma.$executeRaw`
      INSERT INTO recipe_search_documents
        (recipe_id, document_version, content, content_hash, search_vector, updated_at)
      VALUES ${Prisma.join(rows)}
      ON CONFLICT (recipe_id) DO UPDATE SET
        document_version = EXCLUDED.document_version,
        content = EXCLUDED.content,
        content_hash = EXCLUDED.content_hash,
        search_vector = EXCLUDED.search_vector,
        updated_at = EXCLUDED.updated_at`;
  }

  public async upsertEmbeddings(model: string, embeddings: EmbeddingData[]): Promise<void> {
    if (embeddings.length === 0) {
      return;
    }
    const rows = embeddings.map(
      ({ recipeId, contentHash, embedding }) =>
        Prisma.sql`(${recipeId}::uuid, ${model}, ${contentHash}, ${toVectorLiteral(embedding)}::vector)`,
    );
    await this.prisma.$executeRaw`
      INSERT INTO recipe_embeddings (recipe_id, model, content_hash, embedding)
      VALUES ${Prisma.join(rows)}
      ON CONFLICT (recipe_id, model) DO UPDATE SET
        content_hash = EXCLUDED.content_hash,
        embedding = EXCLUDED.embedding,
        created_at = now()`;
  }

  /** Drops the vectors of every model not in `models`; returns how many. */
  public async deleteEmbeddingsExcept(models: string[]): Promise<number> {
    return this.prisma
      .$executeRaw`DELETE FROM recipe_embeddings WHERE model <> ALL(${models}::varchar[])`;
  }

  /**
   * Both legs pre-filter in SQL and run in one transaction with an iterative HNSW scan
   * (pgvector >= 0.8), so a selective filter still yields `candidates` rows. The full-text leg
   * matches any word of the query (OR), ranked by cover density (equal scores by the source of the
   * recipe, the same in every database), and tells whether a recipe has every word (`allWords`);
   * the fusion is `sum of weight / (RECIPE_SEARCH_RRF_K + rank)`.
   */
  public async search(params: HybridSearchParams): Promise<RecipeSearchRow[]> {
    const where = this.filterSql(params.filters);
    const semantic = params.embedding
      ? this.semanticLeg(params.model, params.embedding, where, params.candidates)
      : NO_LEG;
    const lexical = params.text ? this.lexicalLeg(params.text, where, params.candidates) : NO_LEG;
    const { semantic: semanticWeight, lexical: lexicalWeight } = params.weights;

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT set_config('hnsw.ef_search', ${String(RECIPE_SEARCH_EF_SEARCH)}, true),
               set_config('hnsw.iterative_scan', 'relaxed_order', true)`;
      return tx.$queryRaw<RecipeSearchRow[]>`
        WITH semantic AS MATERIALIZED (${semantic}),
        lexical AS MATERIALIZED (${lexical})
        SELECT
          COALESCE(s.recipe_id, l.recipe_id) AS "recipeId",
          (COALESCE(${semanticWeight}::float8 / (${RECIPE_SEARCH_RRF_K} + s.rank), 0)
            + COALESCE(${lexicalWeight}::float8 / (${RECIPE_SEARCH_RRF_K} + l.rank), 0))::float8 AS score,
          s.rank AS "semanticRank",
          l.rank AS "lexicalRank",
          (1 - s.distance)::float8 AS similarity,
          COALESCE(l.all_words, false) AS "allWords"
        FROM semantic s
        FULL OUTER JOIN lexical l ON l.recipe_id = s.recipe_id
        ORDER BY score DESC, "semanticRank" ASC NULLS LAST, "lexicalRank" ASC NULLS LAST, "recipeId"
        LIMIT ${params.limit}`;
    });
  }

  /** Re-ranked by distance: a relaxed iterative scan may return rows slightly out of order. */
  private semanticLeg(
    model: string,
    embedding: number[],
    where: Prisma.Sql,
    candidates: number,
  ): Prisma.Sql {
    const vector = toVectorLiteral(embedding);
    return Prisma.sql`
      SELECT recipe_id, distance, (ROW_NUMBER() OVER (ORDER BY distance, recipe_id))::int AS rank
      FROM (
        SELECT e.recipe_id, (e.embedding <=> ${vector}::vector)::float8 AS distance
        FROM recipe_embeddings e
        JOIN recipes r ON r.id = e.recipe_id
        WHERE e.model = ${model} ${where}
        ORDER BY e.embedding <=> ${vector}::vector
        LIMIT ${candidates}
      ) nearest`;
  }

  private lexicalLeg(text: string, where: Prisma.Sql, candidates: number): Prisma.Sql {
    return Prisma.sql`
      SELECT recipe_id, NULL::float8 AS distance,
        (ROW_NUMBER() OVER (ORDER BY score DESC, source, source_id, recipe_id))::int AS rank, all_words
      FROM (
        SELECT d.recipe_id, r.source, r.source_id,
          ts_rank_cd(d.search_vector, q.query, ${RECIPE_SEARCH_RANK_NORMALIZATION}::int) AS score,
          d.search_vector @@ plainto_tsquery(${RECIPE_SEARCH_TS_CONFIG}::regconfig, ${text}) AS all_words
        FROM recipe_search_documents d
        JOIN recipes r ON r.id = d.recipe_id,
        LATERAL (SELECT replace(plainto_tsquery(${RECIPE_SEARCH_TS_CONFIG}::regconfig, ${text})::text, '&', '|')::tsquery AS query) q
        WHERE d.search_vector @@ q.query ${where}
        ORDER BY score DESC, r.source, r.source_id, d.recipe_id
        LIMIT ${candidates}
      ) matched`;
  }

  /** `AND ...` on the recipe `r`, or nothing. */
  private filterSql({
    mealType,
    dietTypeGroups,
    excludeAllergens,
    maxPrepTimeMinutes,
    excludeRecipeIds,
  }: RecipeSearchFilters): Prisma.Sql {
    const conditions: Prisma.Sql[] = [];
    if (mealType) {
      conditions.push(Prisma.sql`r.meal_type = ${mealType}`);
    }
    for (const tags of dietTypeGroups ?? []) {
      if (tags.length > 0) {
        conditions.push(Prisma.sql`r.diet_type && ${tags}::varchar[]`);
      }
    }
    if (excludeAllergens?.length) {
      conditions.push(Prisma.sql`NOT (r.allergens && ${excludeAllergens}::varchar[])`);
    }
    if (maxPrepTimeMinutes !== undefined) {
      // Unknown time is not quick enough.
      conditions.push(Prisma.sql`r.prep_time_minutes <= ${maxPrepTimeMinutes}`);
    }
    if (excludeRecipeIds?.length) {
      conditions.push(Prisma.sql`r.id <> ALL(${excludeRecipeIds}::uuid[])`);
    }
    return conditions.length > 0
      ? Prisma.sql`AND ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;
  }
}
