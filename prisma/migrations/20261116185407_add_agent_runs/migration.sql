-- CreateTable
CREATE TABLE "agent_runs" (
    "id" UUID NOT NULL,
    "request_id" VARCHAR(128),
    "conversation_id" UUID,
    "user_message_id" UUID,
    "reply_message_id" UUID,
    "outcome" VARCHAR(32) NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "first_text_ms" INTEGER,
    "model_call_count" INTEGER NOT NULL,
    "unfinished_model_call_count" INTEGER NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "cached_input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "tool_call_count" INTEGER NOT NULL,
    "failed_tool_call_count" INTEGER NOT NULL,
    "model_calls" JSONB NOT NULL,
    "tool_calls" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_runs_conversation_id_created_at_idx" ON "agent_runs"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_runs_created_at_idx" ON "agent_runs"("created_at");

-- CreateIndex
CREATE INDEX "agent_runs_user_message_id_idx" ON "agent_runs"("user_message_id");

-- CreateIndex
CREATE INDEX "agent_runs_reply_message_id_idx" ON "agent_runs"("reply_message_id");

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_user_message_id_fkey" FOREIGN KEY ("user_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_reply_message_id_fkey" FOREIGN KEY ("reply_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
