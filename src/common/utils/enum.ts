/**
 * Reads an enum-like VARCHAR column back into its enum. An unknown value is corrupt data (a script
 * or a manual edit), so it fails loudly instead of silently skipping the rules that depend on it.
 */
export function parseEnum<T extends Record<string, string>>(
  enumObject: T,
  value: string,
  field: string,
): T[keyof T] {
  if (!Object.values<string>(enumObject).includes(value)) {
    throw new Error(`Unknown ${field} "${value}" in the database`);
  }
  return value as T[keyof T];
}
