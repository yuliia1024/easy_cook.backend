import { parse } from 'csv-parse';
import { createReadStream, existsSync } from 'fs';
import { join } from 'path';
import { FoodSource, FoodState, KCAL_PER_GRAM } from '../../src/common/constants';

/**
 * USDA FoodData Central CSV export (https://fdc.nal.usda.gov/download-datasets).
 * Every amount in `food_nutrient.csv` is per 100 g of the food.
 */
export const FDC_NUTRIENT = {
  ENERGY_KCAL: 1008,
  /** Foundation foods usually have Atwater energy instead of 1008. */
  ENERGY_ATWATER_SPECIFIC: 2048,
  ENERGY_ATWATER_GENERAL: 2047,
  PROTEIN: 1003,
  FAT: 1004,
  FAT_NLEA: 1085,
  CARBS_BY_DIFFERENCE: 1005,
  CARBS_BY_SUMMATION: 1050,
} as const;

const NUTRIENT_IDS = new Set<number>(Object.values(FDC_NUTRIENT));

export const DEFAULT_DATA_TYPES = ['foundation_food'];

export interface FdcFood {
  fdcId: string;
  dataType: string;
  description: string;
}

/** Protein/fat/carbs kcal-per-gram factors of one food (`food_calorie_conversion_factor.csv`). */
export interface CalorieFactors {
  protein: number;
  fat: number;
  carbs: number;
}

/** Ready for `food_items`. */
export interface ImportedFood {
  name: string;
  nameEn: string;
  kcalPer100g: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  state: FoodState;
  source: FoodSource.UsdaFdc;
  sourceId: string;
}

/**
 * Words of an FDC description mapped to a state, most specific first:
 * "Beans, black, mature seeds, cooked, boiled" is boiled, "Peanuts, dry-roasted" is roasted.
 */
const STATE_KEYWORDS: Array<[FoodState, RegExp]> = [
  [FoodState.Boiled, /\b(boiled|simmered|poached)\b/],
  [FoodState.Steamed, /\bsteamed\b/],
  [FoodState.Fried, /\b(fried|pan-fried|stir-fried|sauteed)\b/],
  [FoodState.Baked, /\bbaked\b/],
  [FoodState.Roasted, /\b(roasted|grilled|broiled|braised|toasted)\b/],
  [FoodState.Cooked, /\b(cooked|prepared)\b/],
  [FoodState.Canned, /\bcanned\b/],
  [FoodState.Frozen, /\bfrozen\b/],
  [FoodState.Dried, /\b(dried|dry|dehydrated|powder)\b/],
  [FoodState.Raw, /\b(raw|fresh|uncooked)\b/],
];

export function detectFoodState(description: string): FoodState {
  const text = description.toLowerCase();
  return STATE_KEYWORDS.find(([, pattern]) => pattern.test(text))?.[0] ?? FoodState.Other;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Picks the four values from the nutrient amounts of one food, with fallbacks:
 * kcal: 1008 -> 2048 -> 2047 -> food specific factors -> 4/9/4; fat: 1004 -> 1085;
 * carbs: 1005 -> 1050. A value with no source stays null.
 */
export function pickNutrients(
  amounts: Map<number, number>,
  factors?: CalorieFactors,
): Pick<ImportedFood, 'kcalPer100g' | 'proteinG' | 'fatG' | 'carbsG'> {
  const first = (...ids: number[]): number | null => {
    const id = ids.find((nutrientId) => amounts.has(nutrientId));
    return id === undefined ? null : amounts.get(id);
  };

  const proteinG = first(FDC_NUTRIENT.PROTEIN);
  const fatG = first(FDC_NUTRIENT.FAT, FDC_NUTRIENT.FAT_NLEA);
  const carbsG = first(FDC_NUTRIENT.CARBS_BY_DIFFERENCE, FDC_NUTRIENT.CARBS_BY_SUMMATION);

  let kcal = first(
    FDC_NUTRIENT.ENERGY_KCAL,
    FDC_NUTRIENT.ENERGY_ATWATER_SPECIFIC,
    FDC_NUTRIENT.ENERGY_ATWATER_GENERAL,
  );
  if (kcal === null && proteinG !== null && fatG !== null && carbsG !== null) {
    const f = factors ?? KCAL_PER_GRAM;
    kcal = proteinG * f.protein + fatG * f.fat + carbsG * f.carbs;
  }

  const clean = (value: number | null): number | null =>
    value === null ? null : round2(Math.max(value, 0));

  return {
    kcalPer100g: clean(kcal),
    proteinG: clean(proteinG),
    fatG: clean(fatG),
    carbsG: clean(carbsG),
  };
}

/** Foods of the wanted data types that have at least one of the four values. */
export function buildFoodItems(
  foods: FdcFood[],
  nutrients: Map<string, Map<number, number>>,
  factors: Map<string, CalorieFactors> = new Map(),
): ImportedFood[] {
  return foods.flatMap((food) => {
    const values = pickNutrients(nutrients.get(food.fdcId) ?? new Map(), factors.get(food.fdcId));
    if (Object.values(values).every((value) => value === null)) {
      return [];
    }

    const name = food.description.trim();
    return [
      {
        name,
        nameEn: name,
        ...values,
        state: detectFoodState(name),
        source: FoodSource.UsdaFdc as const,
        sourceId: food.fdcId,
      },
    ];
  });
}

async function* readCsv(path: string): AsyncGenerator<Record<string, string>> {
  yield* createReadStream(path).pipe(parse({ columns: true, skip_empty_lines: true, bom: true }));
}

/** Reads an unzipped FDC CSV export folder (`food.csv`, `food_nutrient.csv`, ...). */
export async function readFdcExport(
  dir: string,
  dataTypes: string[] = DEFAULT_DATA_TYPES,
): Promise<ImportedFood[]> {
  for (const file of ['food.csv', 'food_nutrient.csv']) {
    if (!existsSync(join(dir, file))) {
      throw new Error(`${file} not found in ${dir}`);
    }
  }

  const wanted = new Set(dataTypes);
  const foods: FdcFood[] = [];
  for await (const row of readCsv(join(dir, 'food.csv'))) {
    if (wanted.has(row.data_type)) {
      foods.push({ fdcId: row.fdc_id, dataType: row.data_type, description: row.description });
    }
  }
  const fdcIds = new Set(foods.map((food) => food.fdcId));

  const nutrients = new Map<string, Map<number, number>>();
  for await (const row of readCsv(join(dir, 'food_nutrient.csv'))) {
    const nutrientId = Number(row.nutrient_id);
    const amount = Number(row.amount);
    if (
      !fdcIds.has(row.fdc_id) ||
      !NUTRIENT_IDS.has(nutrientId) ||
      row.amount === '' ||
      Number.isNaN(amount)
    ) {
      continue;
    }
    if (!nutrients.has(row.fdc_id)) {
      nutrients.set(row.fdc_id, new Map());
    }
    nutrients.get(row.fdc_id).set(nutrientId, amount);
  }

  return buildFoodItems(foods, nutrients, await readCalorieFactors(dir, fdcIds));
}

/** Optional files; foundation foods carry their own Atwater factors in them. */
async function readCalorieFactors(
  dir: string,
  fdcIds: Set<string>,
): Promise<Map<string, CalorieFactors>> {
  const links = join(dir, 'food_nutrient_conversion_factor.csv');
  const values = join(dir, 'food_calorie_conversion_factor.csv');
  const factors = new Map<string, CalorieFactors>();
  if (!existsSync(links) || !existsSync(values)) {
    return factors;
  }

  const fdcIdByFactorId = new Map<string, string>();
  for await (const row of readCsv(links)) {
    if (fdcIds.has(row.fdc_id)) {
      fdcIdByFactorId.set(row.id, row.fdc_id);
    }
  }
  for await (const row of readCsv(values)) {
    const fdcId = fdcIdByFactorId.get(row.food_nutrient_conversion_factor_id);
    const factor = {
      protein: Number(row.protein_value),
      fat: Number(row.fat_value),
      carbs: Number(row.carbohydrate_value),
    };
    if (fdcId && Object.values(factor).every((v) => Number.isFinite(v) && v > 0)) {
      factors.set(fdcId, factor);
    }
  }
  return factors;
}
