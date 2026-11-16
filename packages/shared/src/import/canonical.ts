/** A value with object keys sorted at every depth and undefined properties dropped; arrays keep their order. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  const withJson = value as { toJSON?: () => unknown };
  if (typeof withJson.toJSON === "function") return canonical(withJson.toJSON());
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => [key, canonical(record[key])]),
  );
}

/**
 * A record as JSON with its keys sorted at every depth (ADR 0057 S-11, S-14). PostgreSQL's jsonb
 * returns keys in its own order and loaders build objects in theirs, so two versions of one
 * record are compared by content, never by key order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value)) ?? "undefined";
}

/**
 * Whether two versions of a record are the same (ADR 0057 S-14): key order is ignored, array
 * order is not, and values compare exactly, so "3.40" and "3.4000" differ. Undo uses it to see
 * that a record still equals what the import wrote; decimals that may be written two ways are
 * kept in their stored form by the kinds (`keepStored`).
 */
export function sameRecord(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}
