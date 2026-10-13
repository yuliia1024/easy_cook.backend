# Easy Cook backend

Menu planner API. NestJS 12 monolith · Prisma 7 (`pg` driver adapter) · PostgreSQL 17 (pgvector image) · class-validator · Jest 30 + Supertest · TypeScript 6 · ESLint 10.
Structure: `configs/`, `common/`, `providers/`, `modules/data-access`, `modules/services`, `entrypoints/api`.
The web app lives in its own repository.

Single user, no auth, local run. Menu generation (LLM, tool calling, RAG) is the next stage; the
`menus` tables are ready for it.

## Ports

| Service  | Host port |
|----------|-----------|
| API      | 3100      |
| Postgres | 5442      |

## Run

```bash
cp .env.example .env
npm install                   # also generates the Prisma client
npm run infra:up              # postgres
npm run db:seed               # base foods + recipes from data/seed (idempotent)
npm run start:dev             # applies migrations, API on http://localhost:3100/api, Swagger on /docs
# or everything in docker:
npm run compose
```

### From scratch

```bash
nvm use && cp .env.example .env && npm install
npm run infra:up
npm run db:reset              # drops everything, applies migrations, seeds
# or: docker compose down -v && npm run infra:up && npm run migration:run && npm run db:seed
npm run db:seed               # second run: "0 created, N updated", same ids and counts
npm run data:import-foods -- --dir data/raw/<FDC folder>   # optional, see "Datasets"
npm run data:verify           # FK integrity, duplicates, control recipes, counts; exit 1 on failure
npm run start:dev             # API on http://localhost:3100/api
```

The web app (`../easy_cook.frontend`, `npm run dev`) runs on http://localhost:5173; its dev server
proxies `/api` to port 3100. A build served from another origin calls the API directly, which
`CORS_ORIGINS=*` in `.env.example` allows.

Requires Node 24 LTS (`.nvmrc`; run `nvm use`). NestJS 12 ships as ESM and the project is CommonJS:
Node loads it through `require(esm)`, and Jest needs `--experimental-vm-modules` for the same
(already in the `test*` scripts).

## Database

The schema is `prisma/schema.prisma`; migrations live in `prisma/migrations` and are applied on
start-up (`prisma migrate deploy`). The CLI reads `DATABASE_URL` through `prisma.config.ts`; the
client is generated into `src/generated/prisma` (git-ignored) on `npm install` and connects through
`@prisma/adapter-pg`.

```bash
NAME=add-something npm run migration:create   # new migration from schema changes (review the SQL)
npm run migration:dev                         # create + apply in one go
npm run migration:status
npm run db:reset                              # drop everything, re-apply migrations, seed
```

| Table | |
|---|---|
| `user_profiles` | age, height, weight, sex, activity level, goal |
| `nutrition_goals` | daily kcal / protein / fat / carbs; append-only, `manual` or `rule_based` + `rule_version` |
| `dietary_preferences` | diet, allergy, disliked food, excluded ingredient |
| `food_items` | values per 100 g **in a given state** (raw, dried, boiled...); null = unknown; unique `source + source_id` |
| `recipes` | meal type, diet tags (`varchar[]`), servings; unique `source + source_id` |
| `recipe_ingredients` | grams for the whole recipe, optional flag, notes, display order |
| `menus`, `menu_versions`, `menu_days`, `menu_meals` | for the AI flow; versions are immutable and keep snapshots of goals and recipes |

Enum-like columns are `VARCHAR`; allowed values are in `src/common/constants` and are validated by
the API (`GET /api/profile/options` lists them).

## Nutrition

`NutritionService` is plain deterministic maths, no database and no LLM:

```
value = quantity_g / 100 × nutrient_per_100g
recipe = Σ ingredients        per serving = recipe / servings
```

- The state matters: 150 g of **dry** rice and 150 g of **boiled** rice are different food items
  with different values. Pick the food that matches what is weighed.
- Optional ingredients are left out unless `?includeOptional=true`.
- An unknown value counts as 0 and is reported in `missing`; the result is then `complete: false`.
- Totals are the sum of the ingredients (`basis: "ingredients_sum"`), not a lab value of the
  cooked dish: water loss and oil left in the pan are not accounted for.

Daily targets (`POST /api/nutrition/goals/calculate`): Mifflin-St Jeor BMR × activity factor,
-15 % / +10 % for lose / gain, protein 1.6–2.0 g/kg, fat 25 % of kcal, carbs the rest
(`src/modules/services/nutrition-goal/energy-requirements.ts`, version `mifflin-st-jeor-v1`).
These are reference values for meal planning, not medical advice.

## API

Everything is under `/api`; Swagger UI on `/docs`.

| Method | Path | |
|---|---|---|
| GET | `/health` | 503 when the database is down |
| GET / PUT / PATCH | `/profile` | the single profile; `GET` is 404 until `PUT` |
| GET | `/profile/options` | allowed values of every enum-like field |
| GET | `/nutrition/goals`, `/nutrition/goals/current`, `/nutrition/goals/preview` | history (newest first), goal in effect, rule based targets without saving |
| POST | `/nutrition/goals` | manual goal (optional future `effectiveFrom`) |
| POST | `/nutrition/goals/calculate` | rule based goal from the profile |
| GET / POST | `/preferences` | values are trimmed and lower-cased; `diet` must be a diet tag |
| DELETE | `/preferences/:id` | |
| GET | `/foods?search=&state=&source=&page=&limit=` | search matches the Ukrainian and English name |
| GET / PATCH | `/foods/:id` | `null` clears a value |
| POST | `/foods` | macros cannot exceed 100 g per 100 g |
| GET | `/recipes?search=&mealType=&dietType=&page=&limit=` | `dietType` repeated or comma separated: the recipe has every tag |
| GET / PATCH / DELETE | `/recipes/:id` | `PATCH` with `ingredients` replaces the list |
| POST | `/recipes` | every ingredient must point to an existing food (400 otherwise) |
| GET | `/recipes/:id/nutrition?includeOptional=` | per ingredient, total, per serving |
| POST | `/recipes/:id/ingredients` | |
| PATCH / DELETE | `/recipes/:id/ingredients/:ingredientId` | |
| GET | `/menus`, `/menus/:id` | read only until the AI flow |

Errors always look like `{ statusCode, message, error, path, timestamp }`.

## Datasets

Large datasets are **not** committed: `data/raw/` and `data/processed/` are git-ignored.
Sources, licences (USDA FDC: public domain, CC0 1.0) and the update procedure:
[docs/data-sources.md](docs/data-sources.md).

| Path | |
|---|---|
| `data/seed/foods.json` | ~45 base foods, values per 100 g (rounded USDA values), committed |
| `data/seed/recipes.json` | 12 recipes using those foods (`food` = slug, or `usda_fdc:<fdc_id>`), committed |
| `data/seed/control-recipes.json` | hand-computed nutrition of 3 seed recipes (arithmetic included), committed |
| `data/raw/` | downloaded datasets |
| `data/processed/` | normalized output of the import |

```bash
npm run data:validate        # checks data/seed without a database (ranges, references, 4/9/4 kcal, control recipes)
npm run db:seed              # upserts seed foods + recipes
npm run data:seed-recipes    # recipes only (the foods must already exist)
npm run data:verify          # checks the database: orphan rows per FK, duplicated source ids,
                             # recipes without ingredients, control recipes via NutritionService, counts
```

### USDA FoodData Central

1. Download **Foundation Foods — CSV** (optionally **SR Legacy — CSV**) from
   https://fdc.nal.usda.gov/download-datasets and unzip it into `data/raw/`.
2. Import (upserts by FDC id, safe to repeat):

   ```bash
   npm run data:import-foods -- --dir data/raw/FoodData_Central_foundation_food_csv_2026-04-30
   # options: --data-types foundation_food,sr_legacy_food   --dry-run   --out data/processed/usda-foods.json
   ```

The importer reads `food.csv` and `food_nutrient.csv` (+ the calorie conversion factor files when
present), keeps the chosen data types, and maps: energy 1008 → 2048 → 2047 → the food's own
calorie factors → 4/9/4; protein 1003; fat 1004 → 1085; carbs 1005 → 1050. The state is detected
from the description (`raw`, `boiled`, `dry`...). Names are English (`name` = `name_en`).

## Tests

```bash
npm test            # unit tests (Jest, *.spec.ts next to each file, incl. scripts/lib)
npm run test:cov    # + coverage report in ./coverage
npm run test:e2e    # Supertest against TEST_DATABASE_URL (created, migrated and wiped automatically)
npm run lint
npm run type-check
```

Shared helpers live in `src/test/`: `createMock<T>()` (auto-mocks every method),
`createPrismaMock()` (every model delegate), `fakeConfig()`, fixtures (`buildFoodItem`,
`buildRecipe`, `buildProfile`...). Every new piece of code ships with its spec.
