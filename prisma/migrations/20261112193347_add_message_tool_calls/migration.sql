-- CreateTable
CREATE TABLE "message_tool_calls" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "tool_name" VARCHAR(64) NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB NOT NULL,
    "error" VARCHAR(32),
    "duration_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_tool_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "message_tool_calls_message_id_position_key" ON "message_tool_calls"("message_id", "position");

-- AddForeignKey
ALTER TABLE "message_tool_calls" ADD CONSTRAINT "message_tool_calls_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
