# Data sources

Where the food and recipe data comes from, what is committed, and how to refresh it.

## Sources

| Data | Source | Licence | In the DB |
|---|---|---|---|
| `data/seed/foods.json` (45 base foods) | Derived from USDA FoodData Central, **SR Legacy**: values per 100 g, rounded; English display names and `state` added for the project | Public domain (CC0 1.0), see below | `food_items`, `source = seed`, `source_id` = slug |
| `data/seed/usda-foods.json` (478 foods) | USDA FoodData Central, **Foundation Foods** + **SR Legacy**, picked by hand from foods common in recipes, all four macros present | Public domain (CC0 1.0), see below | `food_items`, `source = usda_fdc`, `source_id` = FDC id |
| `data/seed/recipes.json` (12 recipes), `data/seed/menu-recipes.json` (288 recipes) | Written for this project; some dish ideas come from Kyiv meal-plan menus (healthynutrition.kyiv.ua, kyiv.perfectbalance.ua), no text or quantities copied | Project's own | `recipes` + `recipe_ingredients`, `source = seed`, `source_id` = slug |
| `data/seed/food-aliases.json` (1265 aliases) | Ingredient names as recipes write them (`scallion`), mapped by hand to the foods of `usda-foods.json` | Project's own; FDC descriptions are CC0 | Not loaded yet, for matching recipe ingredients to foods |
| `data/seed/food-categories.json` | Categories (`FoodCategory`) of the 208 foods the recipes use, assigned by hand | Project's own | Not loaded, recipe diet tags and allergens are derived from it when seeding |
| `data/seed/control-recipes.json` | Hand-computed nutrition of 3 seed recipes, the arithmetic is in the file | Project's own | Not loaded, used by `data:validate` / `data:verify` |
| USDA FoodData Central **Foundation Foods** (default) and optionally **SR Legacy**, CSV | https://fdc.nal.usda.gov/download-datasets | Public domain (CC0 1.0), see below | `food_items`, `source = usda_fdc`, `source_id` = FDC id |
| Foods created through the API | The user | | `food_items`, `source = manual` |
| **RecipeNLG** recipes (planned, DATA-4, prototype only) | https://recipenlg.cs.put.poznan.pl | Non-commercial research and educational use only, see [Recipes](#recipes) | `recipes` + `recipe_ingredients`, `source = recipenlg`, `source_id` = RecipeNLG id |

### USDA FoodData Central

USDA FoodData Central data are in the public domain and not copyrighted. They are published under
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/). No permission is needed,
but USDA asks to be cited:

> U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, 2019. fdc.nal.usda.gov.

Per dataset (put in the release you downloaded):

> U.S. Department of Agriculture, Agricultural Research Service. FoodData Central: Foundation Foods. Version Current: <month year>. Internet: fdc.nal.usda.gov.
>
> U.S. Department of Agriculture, Agricultural Research Service. FoodData Central: SR Legacy, 2018. fdc.nal.usda.gov.

Values are per 100 g of the edible portion in the state the description names (raw, dry, boiled...).
The importer maps energy 1008 → 2048 → 2047 → the food's calorie factors → 4/9/4, protein 1003,
fat 1004 → 1085, carbs 1005 → 1050 (see `scripts/lib/fdc.ts`).

### Recipes

Current state: **the database is seeded with the project's own recipes only** (`recipes.json` +
`menu-recipes.json`, 300 recipes), so no recipe licence applies. Dish ideas from other menus are
fine (an idea is not protected), copying their text, photos or exact recipes is not.

Spike before DATA-4: RecipeNLG was considered for a larger prototype import of ~500 recipes. It is
for non-commercial use only, so if it is imported, **its recipes are replaced before production**
by recipes with a reusable licence (Wikibooks Cookbook, own recipes).

#### RecipeNLG (prototype)

https://recipenlg.cs.put.poznan.pl (code: https://github.com/Glorf/recipenlg, card:
https://huggingface.co/datasets/mbien/recipe_nlg). 2.2 million recipes crawled from cooking
sites. Fields: `title`, `ingredients` (lines with quantities, "1 c. milk", "2 Tbsp. butter"),
`directions` (steps), `link` (original page), `source` (`Gathered` / `Recipes1M`), `NER`
(ingredient names). No meal type, servings, time or nutrition. Quantities are in US units and are
converted to grams with the FDC portion weights (`food_portion.csv` of the release we already
import). The download form on the project site returned HTTP 500 on 2026-10-21, so the CSV
(2.3 GB, 2 231 142 rows) was taken from the Hugging Face copy
[`SandhyaKilari/RecipeNLG_dataset`](https://huggingface.co/datasets/SandhyaKilari/RecipeNLG_dataset)
into `data/raw/recipenlg/` (not committed). That copy is labelled CC BY 4.0 by the uploader; the
RecipeNLG terms below still apply.

Licence: access agreement of Poznań University of Technology (from the dataset card):

> Researcher shall use the Dataset only for non-commercial research and educational purposes.

> If Researcher is employed by a for-profit, commercial entity, Researcher's employer shall also be
> bound by these terms and conditions.

What this means for us:

- Use only in the prototype and in local / test databases; never ship RecipeNLG data to production
  or commit it (`data/seed/` stays RecipeNLG-free).
- The recipes themselves belong to the sites they were crawled from (`link`); RecipeNLG gives no
  right to republish them.
- All imported rows are marked `source = recipenlg`, so they can be found and deleted in one query
  before production.

#### Production replacement (later)

- **Wikibooks Cookbook** (https://en.wikibooks.org/wiki/Cookbook:Recipes): several thousand
  recipes, [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Credit the page
  (title, URL, "Wikibooks contributors"); rows derived from it stay under CC BY-SA 4.0.
- **Own recipes**, written in grams like `data/seed/recipes.json` (already 300).

#### Rejected

| Source | Why not |
|---|---|
| USDA MyPlate Kitchen | Good licence (US government work), but myplate.gov was retired in January 2026 and does not resolve, no bulk download |
| Food.com Recipes and Interactions (Kaggle, `shuyangli94`) | Licence on Kaggle is "Data files © Original Authors". `RAW_recipes` lists ingredient names without quantities; nutrition is in % daily value |
| Food.com Recipes and Reviews (Kaggle, `irkaal`) | Same crawl of Food.com, the licence on the page does not come from the authors; smaller than RecipeNLG |
| Recipe1M+ | Research use only, registration required; part of it is already in RecipeNLG (`source = Recipes1M`) |
| TheMealDB, Spoonacular, Edamam | API terms: paid plan for production use and/or storing the content is not allowed |

#### Selection criteria (first import, ~500 recipes)

RecipeNLG has no meal type or servings, so the filter is automatic plus a check by the importer:

- Only `source = Gathered` rows (cleaner than `Recipes1M`); English title; no duplicate by
  normalized title.
- 3-12 ingredient lines, at most `MAX_RECIPE_INGREDIENTS`.
- Every ingredient line has an amount that converts to grams: a weight, a volume with an FDC
  portion weight, or a count with a known weight ("1 medium onion"). "To taste" only for salt,
  pepper and spices, imported as `isOptional`. A range takes the smaller amount.
- At least 90 % of the recipe weight matches `food_items` in the state that is weighed (dry vs
  cooked); recipes with any unmatched main ingredient are skipped.
- At least 2 direction steps.
- No "can" / "pkg." / "jar" without a weight, no sizes in inches ("1 (12 inch) baguette"), no
  branded mixes (most rejects in the sample).
- Meal type from the title and ingredients (keywords: pancake, omelet, oatmeal → breakfast;
  soup, salad, sandwich → lunch; ...); recipes without a clear meal type are skipped. Desserts,
  drinks, sauces, preserves and baking without a meal (cakes, cookies, bread) are skipped.
  Target mix: about 30 % breakfast, 30 % lunch, 30 % dinner, 10 % snack (`MealType`).
- Servings from "serves N" / "makes N" in the directions, otherwise from the total weight
  (about 350 g per serving), so that one serving stays within `MAX_SERVING_WEIGHT_G` /
  `MAX_SERVING_KCAL`.
- `dietType` and the allergens are derived from the categories of the matched foods (see
  [Updating](#updating)), not from the source's text; a mismatch with a source tag goes to the report.

#### Sample check (2026-10-21)

20 recipes checked by hand: a seeded random sample of 18 RecipeNLG rows that pass the automatic
filters above (5 breakfast, 5 lunch, 5 dinner, 3 snack) and 2 seed recipes.

- RecipeNLG: 6 of 18 usable as is, 7 after an edit (a branded or rare item mapped to a plain food,
  a step fixed), 5 rejected: cans / packages without a size (3), baking instead of a meal (1),
  steps that do not match the ingredients (1). Seed: 2 of 2.
- Servings are given in 1 of 18; the importer estimates them from the total weight.
- About 136 000 rows pass the automatic filters (breakfast 11 458, lunch 46 036, dinner 69 672,
  snack 8 750). With a third usable as is, ~2 000 screened rows give 500 recipes, so recipes that
  need an edit can simply be dropped.

#### Provenance (for DATA-4)

| Field | Value |
|---|---|
| `source` | `recipenlg` (new `RecipeSource` value) |
| `source_id` (≤ `SOURCE_ID_MAX_LENGTH`) | RecipeNLG row id |
| Original URL | `link` |
| Import date and source version | date of the run, RecipeNLG release (file name / checksum) |

`recipes` has no columns for the URL, import date or source version yet; DATA-4 adds them.

## Committed vs not committed

| Path | Committed | |
|---|---|---|
| `data/seed/*.json` | yes | reviewed by hand; `foods.json`, `usda-foods.json`, `recipes.json`, `menu-recipes.json` are loaded by `npm run db:seed` |
| `data/raw/` | no (git-ignored) | downloaded FDC exports and the RecipeNLG CSV, hundreds of MB |
| `data/processed/` | no (git-ignored) | normalized output of `data:import-foods` (the full FDC release, not the hand-picked `data/seed/usda-foods.json`) |

Anyone can rebuild the imported foods from the public FDC release. The seed data alone is enough
to run the app.

## Updating

Seed data (`data/seed/`):

1. Edit the JSON. Food values stay per 100 g of the food in its `state`; unknown = `null`, never 0.
   A recipe ingredient is a slug of `foods.json` or `usda_fdc:<FDC id>` of a food in `usda-foods.json`
   (copy a food there from the FDC release when a recipe needs a new one).
2. A food new to the recipes gets its categories in `food-categories.json` (`data:validate` fails
   without them). Recipe tags `vegan`, `vegetarian`, `pescatarian`, `gluten_free` and `dairy_free`
   are derived from the categories of all the ingredients, optional ones included, and stored by
   `db:seed`; the tags written in the recipe files are only the source's claim. `high_protein` and
   `low_carb` are taken as written. `npm run data:classify` reports a source tag the ingredients
   contradict (`not vegetarian (salmon-raw)`) and a derived tag the source misses; fix the recipe
   file or the categories by hand. Allergens (`Allergen`) come from the same categories and are
   stored in `recipes.allergens`, which the menu rules check against the profile allergies.
3. If a control recipe or a food it uses changed, recompute its values in `control-recipes.json` by hand.
4. `npm run data:coverage`: every derived diet (vegan, vegetarian, pescatarian, gluten_free,
   dairy_free) needs at least 14 breakfasts, lunches and dinners (`MIN_RECIPES_PER_MEAL`), so that
   a 7-day menu repeats none even for vegan. A vegan recipe counts for vegetarian and pescatarian
   too. Exit code 1 lists the short pairs (`short vegan dinner: 5, needs 9 more`).
5. `npm run data:validate`, then `npm run db:seed` (upsert by slug, safe to repeat), then `npm run data:verify`.
   A recipe that breaks an import rule (no instruction, an ingredient not matched to a food, an
   unknown nutrient of a counted ingredient, a serving outside 50-2500 kcal) is not seeded and is
   reported as `rejected <slug>: <reasons>`; `data:verify` applies the same rules to the database.

USDA foods, on a new FDC release:

1. Download **Foundation Foods — CSV** (optionally **SR Legacy — CSV**) from
   https://fdc.nal.usda.gov/download-datasets and unzip it into `data/raw/`.
2. Optionally check what would change: `npm run data:import-foods -- --dir data/raw/<folder> --dry-run`
   (writes `data/processed/usda-foods.json`, no database writes).
3. Import: `npm run data:import-foods -- --dir data/raw/<folder>` (add
   `--data-types foundation_food,sr_legacy_food` for SR Legacy). The import is an upsert by
   (`usda_fdc`, FDC id): existing foods get the new values, new ones are added, nothing is duplicated.
   Foods missing from a release are kept (recipes may use them).
4. `npm run data:verify`: no orphan rows, no duplicated (`source`, `source_id`), every recipe has
   ingredients, the control recipes still give the hand-computed nutrition. Exit code 1 on failure.
