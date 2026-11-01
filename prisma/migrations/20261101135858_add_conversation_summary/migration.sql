-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "last_summarized_message_id" UUID,
ADD COLUMN     "summary" TEXT;
