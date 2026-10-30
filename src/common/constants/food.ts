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

/** Allowed gap between the stated kcal and the 4/9/4 estimate (fibre, polyols, rounding). */
export const FOOD_KCAL_TOLERANCE = { absolute: 20, relative: 0.25 } as const;

/**
 * What a food is, for deriving the diet tags and allergens of a recipe; a food may have several.
 * `gluten_grain` is wheat, barley, rye and oats (not certified gluten-free).
 */
export enum FoodCategory {
  Meat = 'meat',
  Poultry = 'poultry',
  Fish = 'fish',
  Shellfish = 'shellfish',
  Egg = 'egg',
  Dairy = 'dairy',
  Honey = 'honey',
  GlutenGrain = 'gluten_grain',
  Grain = 'grain',
  Legume = 'legume',
  Soy = 'soy',
  Peanut = 'peanut',
  TreeNut = 'tree_nut',
  Seed = 'seed',
  Sesame = 'sesame',
  Vegetable = 'vegetable',
  Fruit = 'fruit',
  Mushroom = 'mushroom',
  HerbSpice = 'herb_spice',
  Fat = 'fat',
  Sweetener = 'sweetener',
  Condiment = 'condiment',
  Beverage = 'beverage',
  Other = 'other',
}

export enum Allergen {
  Gluten = 'gluten',
  Milk = 'milk',
  Egg = 'egg',
  Fish = 'fish',
  Shellfish = 'shellfish',
  Peanut = 'peanut',
  TreeNut = 'tree_nut',
  Soy = 'soy',
  Sesame = 'sesame',
}

/** The allergen a food of the category contains. */
export const CATEGORY_ALLERGENS: Readonly<Partial<Record<FoodCategory, Allergen>>> = {
  [FoodCategory.GlutenGrain]: Allergen.Gluten,
  [FoodCategory.Dairy]: Allergen.Milk,
  [FoodCategory.Egg]: Allergen.Egg,
  [FoodCategory.Fish]: Allergen.Fish,
  [FoodCategory.Shellfish]: Allergen.Shellfish,
  [FoodCategory.Peanut]: Allergen.Peanut,
  [FoodCategory.TreeNut]: Allergen.TreeNut,
  [FoodCategory.Soy]: Allergen.Soy,
  [FoodCategory.Sesame]: Allergen.Sesame,
};
