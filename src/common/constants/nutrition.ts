export enum CalculationMode {
  Manual = 'manual',
  RuleBased = 'rule_based',
}

export enum MenuGeneratedBy {
  Manual = 'manual',
  Llm = 'llm',
}

/** Bump when the formulas in `energy-requirements.ts` change; stored with every rule based goal. */
export const NUTRITION_RULE_VERSION = 'mifflin-st-jeor-v1';

export const KCAL_PER_GRAM = { protein: 4, fat: 9, carbs: 4 } as const;
