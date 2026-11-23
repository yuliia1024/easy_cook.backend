-- CreateTable
CREATE TABLE "food_item_translations" (
    "food_item_id" UUID NOT NULL,
    "locale" VARCHAR(8) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "food_item_translations_pkey" PRIMARY KEY ("food_item_id","locale")
);

-- CreateTable
CREATE TABLE "recipe_translations" (
    "recipe_id" UUID NOT NULL,
    "locale" VARCHAR(8) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "instructions" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "recipe_translations_pkey" PRIMARY KEY ("recipe_id","locale")
);

-- CreateTable
CREATE TABLE "recipe_ingredient_translations" (
    "recipe_ingredient_id" UUID NOT NULL,
    "locale" VARCHAR(8) NOT NULL,
    "notes" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "recipe_ingredient_translations_pkey" PRIMARY KEY ("recipe_ingredient_id","locale")
);

-- AddForeignKey
ALTER TABLE "food_item_translations" ADD CONSTRAINT "food_item_translations_food_item_id_fkey" FOREIGN KEY ("food_item_id") REFERENCES "food_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_translations" ADD CONSTRAINT "recipe_translations_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredient_translations" ADD CONSTRAINT "recipe_ingredient_translations_recipe_ingredient_id_fkey" FOREIGN KEY ("recipe_ingredient_id") REFERENCES "recipe_ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
