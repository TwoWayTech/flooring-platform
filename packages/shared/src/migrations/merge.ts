const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Fills settings saved by an older demo with the defaults of sections and fields added since.
 * Saved values win; arrays are taken whole from the saved side, so a saved list is never mixed
 * with the default one.
 */
export function mergeDefaults<T>(defaults: T, saved: unknown): T {
  if (!isPlainObject(defaults) || !isPlainObject(saved)) return (saved === undefined ? defaults : saved) as T;
  const merged: Record<string, unknown> = { ...defaults };
  for (const [key, value] of Object.entries(saved)) {
    merged[key] = key in defaults ? mergeDefaults((defaults as Record<string, unknown>)[key], value) : value;
  }
  return merged as T;
}
