/**
 * The words of a search, lower-cased: split on spaces and commas, so "boiled white rice" finds
 * "Rice, white, boiled" when every word is matched on its own.
 */
export function searchWords(search: string | undefined): string[] {
  return (search ?? '')
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((word) => word.length > 0);
}
