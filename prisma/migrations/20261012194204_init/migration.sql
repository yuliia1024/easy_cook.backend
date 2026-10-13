-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL,
    "age" INTEGER NOT NULL,
    "height_cm" DECIMAL(5,1) NOT NULL,
    "weight_kg" DECIMAL(5,1) NOT NULL,
    "sex" VARCHAR(16) NOT NULL,
    "activity_level" VARCHAR(32) NOT NULL,
    "goal" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_goals" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "calories_kcal" DECIMAL(7,1) NOT NULL,
    "protein_g" DECIMAL(6,1) NOT NULL,
    "fat_g" DECIMAL(6,1) NOT NULL,
    "carbs_g" DECIMAL(6,1) NOT NULL,
    "calculation_mode" VARCHAR(16) NOT NULL,
    "rule_version" VARCHAR(32),
    "effective_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nutrition_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dietary_preferences" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "preference_type" VARCHAR(32) NOT NULL,
    "value" VARCHAR(120) NOT NULL,

    CONSTRAINT "dietary_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_items" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "name_en" VARCHAR(255),
    "kcal_per_100g" DECIMAL(7,2),
    "protein_g" DECIMAL(6,2),
    "fat_g" DECIMAL(6,2),
    "carbs_g" DECIMAL(6,2),
    "state" VARCHAR(32) NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "source_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "food_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "instructions" TEXT NOT NULL,
    "meal_type" VARCHAR(32) NOT NULL,
    "diet_type" VARCHAR(32)[] DEFAULT ARRAY[]::VARCHAR(32)[],
    "servings" INTEGER NOT NULL,
    "prep_time_minutes" INTEGER,
    "source" VARCHAR(32) NOT NULL,
    "source_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_ingredients" (
    "id" UUID NOT NULL,
    "recipe_id" UUID NOT NULL,
    "food_item_id" UUID NOT NULL,
    "quantity_g" DECIMAL(8,2) NOT NULL,
    "is_optional" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "recipe_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menus" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_versions" (
    "id" UUID NOT NULL,
    "menu_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "generated_by" VARCHAR(16) NOT NULL,
    "nutrition_goals_snapshot" JSONB NOT NULL,
    "composition_snapshot" JSONB NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_days" (
    "id" UUID NOT NULL,
    "menu_version_id" UUID NOT NULL,
    "day_index" INTEGER NOT NULL,
    "date" DATE,

    CONSTRAINT "menu_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_meals" (
    "id" UUID NOT NULL,
    "menu_day_id" UUID NOT NULL,
    "meal_type" VARCHAR(32) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "recipe_id" UUID,
    "servings" DECIMAL(5,2) NOT NULL,
    "recipe_snapshot" JSONB NOT NULL,

    CONSTRAINT "menu_meals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nutrition_goals_profile_id_effective_from_idx" ON "nutrition_goals"("profile_id", "effective_from" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "dietary_preferences_profile_id_preference_type_value_key" ON "dietary_preferences"("profile_id", "preference_type", "value");

-- CreateIndex
CREATE INDEX "food_items_name_trgm_idx" ON "food_items" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "food_items_name_en_trgm_idx" ON "food_items" USING GIN ("name_en" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "food_items_source_source_id_key" ON "food_items"("source", "source_id");

-- CreateIndex
CREATE INDEX "recipes_meal_type_idx" ON "recipes"("meal_type");

-- CreateIndex
CREATE INDEX "recipes_diet_type_idx" ON "recipes" USING GIN ("diet_type");

-- CreateIndex
CREATE INDEX "recipes_name_trgm_idx" ON "recipes" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "recipes_source_source_id_key" ON "recipes"("source", "source_id");

-- CreateIndex
CREATE INDEX "recipe_ingredients_recipe_id_idx" ON "recipe_ingredients"("recipe_id");

-- CreateIndex
CREATE INDEX "recipe_ingredients_food_item_id_idx" ON "recipe_ingredients"("food_item_id");

-- CreateIndex
CREATE INDEX "menus_profile_id_idx" ON "menus"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "menu_versions_menu_id_version_number_key" ON "menu_versions"("menu_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "menu_days_menu_version_id_day_index_key" ON "menu_days"("menu_version_id", "day_index");

-- CreateIndex
CREATE INDEX "menu_meals_menu_day_id_idx" ON "menu_meals"("menu_day_id");

-- CreateIndex
CREATE INDEX "menu_meals_recipe_id_idx" ON "menu_meals"("recipe_id");

-- AddForeignKey
ALTER TABLE "nutrition_goals" ADD CONSTRAINT "nutrition_goals_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dietary_preferences" ADD CONSTRAINT "dietary_preferences_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_food_item_id_fkey" FOREIGN KEY ("food_item_id") REFERENCES "food_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menus" ADD CONSTRAINT "menus_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_versions" ADD CONSTRAINT "menu_versions_menu_id_fkey" FOREIGN KEY ("menu_id") REFERENCES "menus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_days" ADD CONSTRAINT "menu_days_menu_version_id_fkey" FOREIGN KEY ("menu_version_id") REFERENCES "menu_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_meals" ADD CONSTRAINT "menu_meals_menu_day_id_fkey" FOREIGN KEY ("menu_day_id") REFERENCES "menu_days"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_meals" ADD CONSTRAINT "menu_meals_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

