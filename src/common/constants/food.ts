/** Nutrition values of a food item always describe 100 g of the product in this state. */
export enum FoodState {
  Raw = 'raw',
  /** Cooked in an unspecified way. */
  Cooked = 'cooked',
  Boiled = 'boiled',
  Steamed = 'steamed',
  Fried = 'fried',
  Baked = 'baked',
  Roasted = 'roasted',
  Dried = 'dried',
  Canned = 'canned',
  Frozen = 'frozen',
  /** Not applicable (salt, oil, sauces...). */
  Other = 'other',
}

export enum FoodSource {
  /** USDA FoodData Central, `source_id` is the FDC id. */
  UsdaFdc = 'usda_fdc',
  /** `data/seed/foods.json`, `source_id` is a slug. */
  Seed = 'seed',
  /** Created through the API. */
  Manual = 'manual',
}

export const FOOD_NAME_MAX_LENGTH = 255;
export const SOURCE_ID_MAX_LENGTH = 64;
/** Pure fat, the most energy-dense food. */
export const MAX_KCAL_PER_100G = 900;
