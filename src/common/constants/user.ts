export enum Gender {
  Male = 'male',
  Female = 'female',
  Other = 'other',
}

export enum Diet {
  /** Eats everything. */
  Omnivore = 'omnivore',
  /** No meat and fish, but dairy and eggs. */
  Vegetarian = 'vegetarian',
  /** No animal products at all. */
  Vegan = 'vegan',
  /** Vegetarian plus fish and seafood. */
  Pescatarian = 'pescatarian',
  /** Mostly plant based, meat occasionally. */
  Flexitarian = 'flexitarian',
  /** Low carb, high fat. */
  Keto = 'keto',
  Paleo = 'paleo',
}

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 64;
/** At least one letter and one digit. */
export const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d).+$/;
export const FIRST_NAME_MAX_LENGTH = 50;
