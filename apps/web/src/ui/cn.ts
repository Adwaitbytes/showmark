type ClassValue = string | false | null | undefined;

/** Joins class names, skipping falsy entries. Later classes do not override earlier ones; keep variants disjoint. */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
