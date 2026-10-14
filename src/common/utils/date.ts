/** `YYYY-MM-DD` as midnight UTC, the way a DATE column is read back; null when there is none. */
export const toDate = (value: string | null | undefined): Date | null =>
  value ? new Date(`${value}T00:00:00.000Z`) : null;
