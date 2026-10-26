/**
 * Reference tables for converting recipe amounts to grams (`units.ts`).
 * Cup weights and piece weights are typical US values: USDA SR Legacy portions and the
 * King Arthur ingredient weight chart.
 */

export type MassUnit = 'g' | 'kg' | 'mg' | 'oz' | 'lb';
export type VolumeUnit =
  'ml' | 'l' | 'pinch' | 'dash' | 'tsp' | 'tbsp' | 'fl oz' | 'cup' | 'pint' | 'quart' | 'gallon';
export type CountUnit = 'piece' | 'clove' | 'slice' | 'stalk';
export type Unit = MassUnit | VolumeUnit | CountUnit;
export type PieceSize = 'small' | 'medium' | 'large';

export const GRAMS_PER_MASS_UNIT: Record<MassUnit, number> = {
  mg: 0.001,
  g: 1,
  kg: 1000,
  oz: 28.3495,
  lb: 453.592,
};

/** US customary units. A pinch is 1/16 tsp, a dash 1/8 tsp. */
export const ML_PER_VOLUME_UNIT: Record<VolumeUnit, number> = {
  ml: 1,
  l: 1000,
  pinch: 0.308,
  dash: 0.616,
  tsp: 4.92892,
  tbsp: 14.7868,
  'fl oz': 29.5735,
  cup: 236.588,
  pint: 473.176,
  quart: 946.353,
  gallon: 3785.41,
};

export const COUNT_UNITS: readonly CountUnit[] = ['piece', 'clove', 'slice', 'stalk'];
export const PIECE_SIZES: readonly PieceSize[] = ['small', 'medium', 'large'];

/** Containers whose weight depends on the product; never converted without a stated weight. */
export const CONTAINER_UNITS: readonly string[] = [
  'can',
  'cans',
  'jar',
  'jars',
  'package',
  'packages',
  'pkg',
  'pkgs',
  'box',
  'boxes',
  'bag',
  'bags',
  'carton',
  'cartons',
  'bottle',
  'bottles',
  'envelope',
  'envelopes',
  'container',
  'containers',
  'bunch',
  'bunches',
  'handful',
  'handfuls',
];

/**
 * Spellings in recipes -> unit. Looked up as written first ("T" is a tablespoon, "t" a teaspoon),
 * then in lower case without a trailing dot.
 */
export const UNIT_ALIASES: Record<string, Unit | PieceSize> = {
  T: 'tbsp',
  t: 'tsp',
  g: 'g',
  gr: 'g',
  gram: 'g',
  grams: 'g',
  г: 'g',
  kg: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  кг: 'kg',
  mg: 'mg',
  oz: 'oz',
  ounce: 'oz',
  ounces: 'oz',
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
  ml: 'ml',
  milliliter: 'ml',
  milliliters: 'ml',
  millilitre: 'ml',
  millilitres: 'ml',
  мл: 'ml',
  l: 'l',
  liter: 'l',
  liters: 'l',
  litre: 'l',
  litres: 'l',
  л: 'l',
  pinch: 'pinch',
  pinches: 'pinch',
  щіпка: 'pinch',
  dash: 'dash',
  dashes: 'dash',
  tsp: 'tsp',
  tsps: 'tsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  'ч.л': 'tsp',
  tbsp: 'tbsp',
  tbsps: 'tbsp',
  tbs: 'tbsp',
  tbl: 'tbsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  'ст.л': 'tbsp',
  'fl oz': 'fl oz',
  'fl. oz': 'fl oz',
  'fluid ounce': 'fl oz',
  'fluid ounces': 'fl oz',
  c: 'cup',
  cup: 'cup',
  cups: 'cup',
  склянка: 'cup',
  pt: 'pint',
  pint: 'pint',
  pints: 'pint',
  qt: 'quart',
  quart: 'quart',
  quarts: 'quart',
  gal: 'gallon',
  gallon: 'gallon',
  gallons: 'gallon',
  piece: 'piece',
  pieces: 'piece',
  pc: 'piece',
  pcs: 'piece',
  each: 'piece',
  whole: 'piece',
  шт: 'piece',
  clove: 'clove',
  cloves: 'clove',
  slice: 'slice',
  slices: 'slice',
  stalk: 'stalk',
  stalks: 'stalk',
  rib: 'stalk',
  ribs: 'stalk',
  small: 'small',
  medium: 'medium',
  med: 'medium',
  large: 'large',
  lg: 'large',
};

export interface Density {
  /** Matched against the lower-cased food name, the first match wins. */
  match: RegExp;
  gPerMl: number;
}

/** Specific foods before generic ones ("peanut butter" before "butter"). */
export const DENSITIES: readonly Density[] = [
  { match: /peanut butter|peanuts?.*butter/, gPerMl: 1.08 },
  { match: /buttermilk/, gPerMl: 1.03 },
  { match: /brown sugar|sugars?, brown/, gPerMl: 0.93 },
  { match: /powdered sugar|confectioners|icing sugar|sugars?, powdered/, gPerMl: 0.51 },
  { match: /\bsugars?\b/, gPerMl: 0.85 },
  { match: /\bbutter\b|margarine|\bghee\b/, gPerMl: 0.96 },
  { match: /shortening|\blard\b/, gPerMl: 0.87 },
  { match: /\boil\b|\boil,/, gPerMl: 0.92 },
  { match: /honey/, gPerMl: 1.42 },
  { match: /molasses/, gPerMl: 1.43 },
  { match: /corn syrup|syrups?, corn/, gPerMl: 1.39 },
  { match: /maple syrup|syrups?, maple/, gPerMl: 1.33 },
  { match: /whole wheat flour|flour, whole wheat|wheat flour, whole/, gPerMl: 0.51 },
  { match: /cornstarch|corn starch/, gPerMl: 0.54 },
  { match: /cornmeal|corn meal/, gPerMl: 0.58 },
  { match: /\bflour\b/, gPerMl: 0.53 },
  { match: /cocoa/, gPerMl: 0.36 },
  { match: /baking powder|baking soda|leavening agents, baking/, gPerMl: 0.93 },
  { match: /kosher salt/, gPerMl: 0.65 },
  { match: /\bsalt\b/, gPerMl: 1.22 },
  { match: /vanilla/, gPerMl: 0.88 },
  {
    match:
      /\bspices?\b.*(dried|leaf|leaves)|dried (oregano|basil|thyme|rosemary|dill|parsley)|parsley flakes/,
    gPerMl: 0.2,
  },
  {
    match:
      /\bspices?\b|ground (cinnamon|cumin|ginger|nutmeg|cloves|allspice|coriander|pepper)|powder\b|paprika|black pepper/,
    gPerMl: 0.5,
  },
  { match: /parmesan|grated cheese/, gPerMl: 0.42 },
  { match: /cream cheese|cheese, cream/, gPerMl: 0.98 },
  { match: /cottage cheese|cheese, cottage|ricotta/, gPerMl: 0.95 },
  { match: /\bcheese\b/, gPerMl: 0.47 },
  { match: /sour cream|cream, sour|yogurt|yoghurt/, gPerMl: 1.03 },
  { match: /\bcream\b|half and half|half-and-half/, gPerMl: 1.01 },
  { match: /\bmilk\b/, gPerMl: 1.03 },
  { match: /mayonnaise/, gPerMl: 0.93 },
  { match: /ketchup|catsup/, gPerMl: 1.15 },
  { match: /mustard/, gPerMl: 1.01 },
  { match: /soy sauce|worcestershire/, gPerMl: 1.08 },
  { match: /tomato paste|tomato, paste|paste, canned/, gPerMl: 1.11 },
  { match: /tomato sauce|sauce, canned|tomatoes?, .*canned|canned tomatoes/, gPerMl: 1.04 },
  { match: /\bjuice\b/, gPerMl: 1.04 },
  { match: /broth|stock|bouillon|\bwater\b|vinegar|\bwine\b|coffee|\btea\b|\bbeer\b/, gPerMl: 1.0 },
  { match: /rolled oats|oats|oatmeal/, gPerMl: 0.34 },
  { match: /\brice\b.*(cooked|boiled)|cooked rice/, gPerMl: 0.67 },
  { match: /\brice\b/, gPerMl: 0.78 },
  { match: /quinoa/, gPerMl: 0.72 },
  { match: /lentils/, gPerMl: 0.81 },
  { match: /chocolate chips|semisweet chocolate|chocolate morsels/, gPerMl: 0.71 },
  { match: /raisins/, gPerMl: 0.61 },
  { match: /coconut/, gPerMl: 0.39 },
  { match: /bread crumbs|breadcrumbs|crumbs/, gPerMl: 0.46 },
  { match: /pecans|walnuts|almonds|\bnuts\b|cashews|hazelnuts|pistachios/, gPerMl: 0.5 },
  { match: /green onions?|scallions?|onions, spring/, gPerMl: 0.42 },
  { match: /\bonions?\b/, gPerMl: 0.68 },
  { match: /celery/, gPerMl: 0.43 },
  { match: /carrots?/, gPerMl: 0.54 },
  { match: /bell peppers?|peppers, sweet|peppers, bell|green peppers?/, gPerMl: 0.63 },
  { match: /\btomato(es)?\b/, gPerMl: 0.76 },
  { match: /mushrooms?/, gPerMl: 0.3 },
  { match: /garlic/, gPerMl: 0.57 },
  { match: /spinach/, gPerMl: 0.13 },
  { match: /broccoli/, gPerMl: 0.38 },
  { match: /\bcorn\b/, gPerMl: 0.65 },
  { match: /\bpeas\b/, gPerMl: 0.57 },
  { match: /blueberries/, gPerMl: 0.63 },
  { match: /strawberries/, gPerMl: 0.7 },
  { match: /cranberries/, gPerMl: 0.42 },
  { match: /parsley/, gPerMl: 0.25 },
  { match: /cilantro|coriander.*leaves/, gPerMl: 0.07 },
];

export interface PieceWeight {
  /** Matched against the lower-cased food name, the first match wins. */
  match: RegExp;
  unit: CountUnit;
  /** Grams of the edible part per piece; a size without a value is not converted. */
  grams: Partial<Record<PieceSize, number>>;
}

export const PIECE_WEIGHTS: readonly PieceWeight[] = [
  { match: /\begg.*\byolks?\b/, unit: 'piece', grams: { small: 14, medium: 16, large: 17 } },
  { match: /\begg.*\bwhites?\b/, unit: 'piece', grams: { small: 27, medium: 30, large: 33 } },
  { match: /\beggs?\b/, unit: 'piece', grams: { small: 38, medium: 44, large: 50 } },
  { match: /garlic/, unit: 'clove', grams: { small: 2, medium: 3, large: 5 } },
  {
    match: /green onions?|scallions?|onions, spring/,
    unit: 'piece',
    grams: { small: 5, medium: 15, large: 25 },
  },
  { match: /\bonions?\b/, unit: 'piece', grams: { small: 70, medium: 110, large: 150 } },
  { match: /carrots?/, unit: 'piece', grams: { small: 50, medium: 61, large: 72 } },
  { match: /celery/, unit: 'stalk', grams: { small: 17, medium: 40, large: 64 } },
  { match: /sweet potato/, unit: 'piece', grams: { medium: 130 } },
  { match: /potato(es)?/, unit: 'piece', grams: { small: 170, medium: 213, large: 369 } },
  {
    match: /cherry tomato|grape tomato|tomatoes, (cherry|grape)/,
    unit: 'piece',
    grams: { medium: 17 },
  },
  { match: /\btomato(es)?\b/, unit: 'piece', grams: { small: 91, medium: 123, large: 182 } },
  {
    match: /bell peppers?|peppers, sweet|peppers, bell|green peppers?/,
    unit: 'piece',
    grams: { small: 74, medium: 119, large: 164 },
  },
  { match: /jalape[nñ]o/, unit: 'piece', grams: { medium: 14 } },
  { match: /zucchini/, unit: 'piece', grams: { small: 118, medium: 196, large: 323 } },
  { match: /cucumber/, unit: 'piece', grams: { medium: 301 } },
  { match: /bananas?/, unit: 'piece', grams: { small: 101, medium: 118, large: 136 } },
  { match: /apples?\b/, unit: 'piece', grams: { small: 149, medium: 182, large: 223 } },
  { match: /lemons?\b/, unit: 'piece', grams: { medium: 58 } },
  { match: /limes?\b/, unit: 'piece', grams: { medium: 67 } },
  { match: /oranges?\b/, unit: 'piece', grams: { small: 96, medium: 131, large: 184 } },
  { match: /avocados?/, unit: 'piece', grams: { medium: 201 } },
  { match: /peach(es)?/, unit: 'piece', grams: { medium: 150 } },
  { match: /pears?\b/, unit: 'piece', grams: { medium: 178 } },
  { match: /bread/, unit: 'slice', grams: { medium: 28 } },
];
