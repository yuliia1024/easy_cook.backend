/** `YYYY-MM-DD` of the UTC day `offset` days from today, for inputs that must not be past. */
export const daysFromToday = (offset: number): string =>
  new Date(Date.now() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
