import { Prisma } from '../../generated/prisma/client';

export type Numeric = Prisma.Decimal | number | string;

/** Prisma returns NUMERIC columns as `Decimal`; the API speaks plain numbers. */
export function toNumber(value: Numeric): number;
export function toNumber(value: Numeric | null | undefined): number | null;
export function toNumber(value: Numeric | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return Number(value);
}

export function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
