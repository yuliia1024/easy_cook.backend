-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "recipe_search_documents" (
    "recipe_id" UUID NOT NULL,
    "document_version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "search_vector" tsvector NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "recipe_search_documents_pkey" PRIMARY KEY ("recipe_id")
);

-- CreateTable
CREATE TABLE "recipe_embeddings" (
    "recipe_id" UUID NOT NULL,
    "model" VARCHAR(128) NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "embedding" vector(1024) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipe_embeddings_pkey" PRIMARY KEY ("recipe_id","model")
);

-- CreateIndex
CREATE INDEX "recipe_search_documents_search_vector_idx" ON "recipe_search_documents" USING GIN ("search_vector");

-- CreateIndex
CREATE INDEX "recipe_embeddings_model_idx" ON "recipe_embeddings"("model");

-- AddForeignKey
ALTER TABLE "recipe_search_documents" ADD CONSTRAINT "recipe_search_documents_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_embeddings" ADD CONSTRAINT "recipe_embeddings_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex (not in the Prisma schema: it cannot declare HNSW). Cosine distance (`<=>`), the
-- pgvector defaults m = 16, ef_construction = 64. Every model shares it; a query filters by
-- `model` with an iterative index scan (`hnsw.iterative_scan`).
CREATE INDEX "recipe_embeddings_embedding_hnsw_idx" ON "recipe_embeddings" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64);
