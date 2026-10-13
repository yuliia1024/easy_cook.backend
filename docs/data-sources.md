# Data sources

Where the food and recipe data comes from, what is committed, and how to refresh it.

## Sources

| Data | Source | Licence | In the DB |
|---|---|---|---|
| `data/seed/foods.json` (45 base foods) | Derived from USDA FoodData Central, **SR Legacy**: values per 100 g, rounded; Ukrainian names and `state` added for the project | Public domain (CC0 1.0), see below | `food_items`, `source = seed`, `source_id` = slug |
| `data/seed/recipes.json` (12 recipes) | Written for this project | Project's own | `recipes` + `recipe_ingredients`, `source = seed`, `source_id` = slug |
| `data/seed/control-recipes.json` | Hand-computed nutrition of 3 seed recipes, the arithmetic is in the file | Project's own | Not loaded, used by `data:validate` / `data:verify` |
| USDA FoodData Central **Foundation Foods** (default) and optionally **SR Legacy**, CSV | https://fdc.nal.usda.gov/download-datasets | Public domain (CC0 1.0), see below | `food_items`, `source = usda_fdc`, `source_id` = FDC id |
| Foods created through the API | The user | | `food_items`, `source = manual` |

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

## Committed vs not committed

| Path | Committed | |
|---|---|---|
| `data/seed/*.json` | yes | small, reviewed by hand, loaded by `npm run db:seed` |
| `data/raw/` | no (git-ignored) | downloaded FDC exports, hundreds of MB |
| `data/processed/` | no (git-ignored) | normalized output of the import (`usda-foods.json`) |

Anyone can rebuild the imported foods from the public FDC release. The seed data alone is enough
to run the app.

## Updating

Seed data (`data/seed/`):

1. Edit the JSON. Food values stay per 100 g of the food in its `state`; unknown = `null`, never 0.
2. If a control recipe or a food it uses changed, recompute its values in `control-recipes.json` by hand.
3. `npm run data:validate`, then `npm run db:seed` (upsert by slug, safe to repeat), then `npm run data:verify`.

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
