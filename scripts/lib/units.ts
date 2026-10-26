import {
  CONTAINER_UNITS,
  COUNT_UNITS,
  CountUnit,
  DENSITIES,
  GRAMS_PER_MASS_UNIT,
  MassUnit,
  ML_PER_VOLUME_UNIT,
  PIECE_SIZES,
  PIECE_WEIGHTS,
  PieceSize,
  Unit,
  UNIT_ALIASES,
  VolumeUnit,
} from './unit-tables';

/** A unit as recipes use it: "2 large eggs" is `piece` of size `large`. */
export interface ResolvedUnit {
  unit: Unit;
  size?: PieceSize;
}

/** Weight of one unit of a food, from USDA `food_portion.csv`. */
export interface FoodPortion {
  unit: VolumeUnit | CountUnit;
  /** Count units only. */
  size?: PieceSize;
  grams: number;
}

export interface IngredientAmount {
  /** Ingredient or food name, matched against the density and piece tables. */
  food: string;
  amount: number;
  /** As written in the recipe; empty for a plain count ("2 eggs"). */
  unit?: string | null;
}

export type ConversionMethod = 'mass' | 'portion' | 'density' | 'piece';

export type Conversion =
  { grams: number; method: ConversionMethod } | { grams: null; reason: string };

export interface UnresolvedIngredient extends IngredientAmount {
  reason: string;
}

export interface ConvertedIngredient<T extends IngredientAmount> {
  ingredient: T;
  grams: number;
  method: ConversionMethod;
}

export interface ConversionReport<T extends IngredientAmount> {
  converted: Array<ConvertedIngredient<T>>;
  unresolved: Array<T & { reason: string }>;
}

const isMass = (unit: Unit): unit is MassUnit => unit in GRAMS_PER_MASS_UNIT;
const isVolume = (unit: Unit): unit is VolumeUnit => unit in ML_PER_VOLUME_UNIT;
const isCount = (unit: string): unit is CountUnit => COUNT_UNITS.includes(unit as CountUnit);
const isSize = (unit: string): unit is PieceSize => PIECE_SIZES.includes(unit as PieceSize);
const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * "Tbsp." -> tbsp, "c" -> cup, "large" -> piece of size large, empty -> piece.
 * Null for a container ("can") or an unknown word.
 */
export function resolveUnit(raw?: string | null): ResolvedUnit | null {
  const written = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!written) {
    return { unit: 'piece' };
  }

  const alias =
    UNIT_ALIASES[written] ?? UNIT_ALIASES[written.toLowerCase().replace(/\.$/, '')] ?? null;
  if (alias === null) {
    return null;
  }
  return isSize(alias) ? { unit: 'piece', size: alias } : { unit: alias };
}

export function isContainerUnit(raw?: string | null): boolean {
  return CONTAINER_UNITS.includes((raw ?? '').trim().toLowerCase().replace(/\.$/, ''));
}

/**
 * Unit of a USDA portion description: "cup, chopped" -> cup, "medium (2-1/2" dia)" -> piece of
 * size medium, "stalk, large (11"-12" long)" -> stalk of size large. Null for a mass portion
 * ("oz") or a description without a unit ("Quantity not specified").
 */
export function parsePortionUnit(description: string): Omit<FoodPortion, 'grams'> | null {
  const text = description.toLowerCase().trim();
  const size = PIECE_SIZES.find((s) => new RegExp(`\\b${s}\\b`).test(text));
  const head = text
    .split(/[,(]/)[0]
    .replace(/^[\d./\s]+/, '')
    .trim();

  const unit = resolveUnit(head);
  if (unit && isVolume(unit.unit)) {
    return { unit: unit.unit };
  }
  if (unit && isCount(unit.unit)) {
    return { unit: unit.unit, size: unit.size ?? size };
  }
  if (unit && isMass(unit.unit)) {
    return null;
  }
  // "pepper, large (...)", "fruit, without skin and seed": a whole piece of the food.
  if (size || /\b(fruit|whole|each|item)\b/.test(text)) {
    return { unit: 'piece', size };
  }
  return null;
}

/** Grams per ml from the USDA volume portions of the food, if it has any. */
function portionDensity(portions: FoodPortion[]): number | null {
  const volume = portions.find((p) => isVolume(p.unit));
  return volume ? volume.grams / ML_PER_VOLUME_UNIT[volume.unit as VolumeUnit] : null;
}

function tableDensity(food: string): number | null {
  const name = food.toLowerCase();
  return DENSITIES.find((d) => d.match.test(name))?.gPerMl ?? null;
}

function volumeToGrams(
  ingredient: IngredientAmount,
  unit: VolumeUnit,
  portions: FoodPortion[],
): Conversion {
  const exact = portions.find((p) => p.unit === unit);
  if (exact) {
    return { grams: round2(ingredient.amount * exact.grams), method: 'portion' };
  }

  const ml = ingredient.amount * ML_PER_VOLUME_UNIT[unit];
  const fromPortions = portionDensity(portions);
  if (fromPortions !== null) {
    return { grams: round2(ml * fromPortions), method: 'portion' };
  }
  const fromTable = tableDensity(ingredient.food);
  if (fromTable !== null) {
    return { grams: round2(ml * fromTable), method: 'density' };
  }
  return { grams: null, reason: `no density for ${unit}` };
}

function countToGrams(
  ingredient: IngredientAmount,
  { unit, size = 'medium' }: { unit: CountUnit; size?: PieceSize },
  portions: FoodPortion[],
): Conversion {
  const portion = portions.find((p) => p.unit === unit && (p.size ?? 'medium') === size);
  if (portion) {
    return { grams: round2(ingredient.amount * portion.grams), method: 'portion' };
  }

  const name = ingredient.food.toLowerCase();
  const piece = PIECE_WEIGHTS.find((p) => p.unit === unit && p.match.test(name));
  const grams = piece?.grams[size];
  if (grams !== undefined) {
    return { grams: round2(ingredient.amount * grams), method: 'piece' };
  }
  return {
    grams: null,
    reason: piece ? `no ${size} ${unit} weight` : `no ${unit} weight for this food`,
  };
}

/**
 * Amount of an ingredient in grams. Mass units are exact; a volume uses the USDA portions of the
 * food, then `DENSITIES`; a count uses the USDA portions, then `PIECE_WEIGHTS`. Nothing is
 * guessed: without a reliable weight the result carries the reason instead of grams.
 */
export function toGrams(ingredient: IngredientAmount, portions: FoodPortion[] = []): Conversion {
  if (!Number.isFinite(ingredient.amount) || ingredient.amount <= 0) {
    return { grams: null, reason: 'no amount' };
  }
  if (isContainerUnit(ingredient.unit)) {
    return { grams: null, reason: `"${ingredient.unit}" without a weight` };
  }

  const resolved = resolveUnit(ingredient.unit);
  if (!resolved) {
    return { grams: null, reason: `unknown unit "${ingredient.unit}"` };
  }
  const { unit, size } = resolved;

  if (isMass(unit)) {
    return { grams: round2(ingredient.amount * GRAMS_PER_MASS_UNIT[unit]), method: 'mass' };
  }
  if (isVolume(unit)) {
    return volumeToGrams(ingredient, unit, portions);
  }
  return countToGrams(ingredient, { unit, size }, portions);
}

/** Converts every ingredient; those without a reliable weight go to `unresolved`. */
export function convertIngredients<T extends IngredientAmount>(
  ingredients: T[],
  portionsOf: (ingredient: T) => FoodPortion[] = () => [],
): ConversionReport<T> {
  const report: ConversionReport<T> = { converted: [], unresolved: [] };
  for (const ingredient of ingredients) {
    const result = toGrams(ingredient, portionsOf(ingredient));
    if ('reason' in result) {
      report.unresolved.push({ ...ingredient, reason: result.reason });
    } else {
      report.converted.push({ ingredient, grams: result.grams, method: result.method });
    }
  }
  return report;
}

/** One line per (food, unit, reason), the most frequent first: "12  cup | shrimp: no density for cup". */
export function formatUnresolvedReport(unresolved: UnresolvedIngredient[]): string[] {
  const counts = new Map<string, number>();
  for (const { food, unit, reason } of unresolved) {
    const key = `${(unit ?? '').trim() || '-'} | ${food.trim().toLowerCase()}: ${reason}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .map(([key, count]) => `${count}  ${key}`);
}
