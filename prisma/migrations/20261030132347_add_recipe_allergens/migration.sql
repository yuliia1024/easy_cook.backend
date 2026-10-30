-- AlterTable
ALTER TABLE "recipes" ADD COLUMN     "allergens" VARCHAR(32)[] DEFAULT ARRAY[]::VARCHAR(32)[];
