import type { NumberKind } from "./numbers";

/**
 * One side of a change as the audit log shows it (click-through #58): nothing, words, a number
 * shown through the company's number format, or a record named by its id.
 */
export type AuditValue =
  | { kind: "none" }
  | { kind: "text"; text: string }
  | { kind: "number"; value: string; number: NumberKind }
  | { kind: "record"; id: string; name: string | null };

/** One changed field: its label, and the value before and after (null when that side has no value at all). */
export interface AuditChange {
  key: string;
  label: string;
  before: AuditValue | null;
  after: AuditValue | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIMAL = /^-?\d+(\.\d+)?$/;
const ENUM = /^[a-z]+(_[a-z0-9]+)+$/;
/** How deep nested objects are opened into their own lines; deeper ones are summarised. */
const MAX_DEPTH = 2;

/**
 * The number kind a field's name implies, by the blueprint's number kinds: unit costs, money,
 * quantities and percentages. Names are matched on their last word, so `creditLimit` is money and
 * `remainingLengthFt` a quantity.
 */
function numberKind(key: string): NumberKind | null {
  if (/(unitCost|costPerSqFt)$/i.test(key)) return "unitCost";
  if (/(amount|total|subtotal|price|cost|balance|limit|fee|deposit|paid|threshold)$/i.test(key)) return "money";
  if (/(quantity|qty|length|width|area)$/i.test(key) || /Ft$/.test(key)) return "quantity";
  if (/(Pct|percent)$/i.test(key)) return "percent";
  return null;
}

/** Words from a camelCase or snake_case name: `salesRepId` → "Sales rep", `depositPct` → "Deposit %". */
function words(name: string): string {
  const spaced = name
    .replace(/Ids$/, "s")
    .replace(/Id$/, "")
    .replace(/Pct$/, " %")
    .replace(/SqFt/g, " sq ft")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A field's label from its path: `address.city` → "Address city". */
export function auditLabel(path: string): string {
  if (!path) return "Value";
  return path
    .split(".")
    .map((part, i) => (i === 0 ? words(part) : words(part).toLowerCase()))
    .join(" ");
}

/** A stored value written for people: `due_on_receipt` → "Due on receipt". */
function plainWords(text: string): string {
  return ENUM.test(text) ? words(text) : text;
}

/** A record by its name, or one the log could not name by the start of its id, so two can still be told apart. */
export function auditRecordLabel(value: { id: string; name: string | null }): string {
  return value.name ?? `Record ${value.id.slice(0, 8)}`;
}

/** One value as the log shows it, with ids named from `names` where the log found them. */
function auditValue(key: string, value: unknown, names: Readonly<Record<string, string>>): AuditValue {
  if (value === null || value === undefined || value === "") return { kind: "none" };
  if (typeof value === "boolean") return { kind: "text", text: value ? "Yes" : "No" };
  if (typeof value === "string" && UUID.test(value)) return { kind: "record", id: value, name: names[value] ?? null };
  if (Array.isArray(value)) {
    if (value.some((item) => typeof item === "object" && item !== null)) {
      return { kind: "text", text: value.length === 1 ? "1 item" : `${value.length} items` };
    }
    const items = value.map((item) => {
      const one = auditValue(key, item, names);
      return one.kind === "record" ? auditRecordLabel(one) : one.kind === "text" ? one.text : String(item);
    });
    return items.length ? { kind: "text", text: items.join(", ") } : { kind: "none" };
  }
  if (typeof value === "object") return { kind: "text", text: JSON.stringify(value) };
  const text = String(value);
  const kind = numberKind(key);
  if (kind && DECIMAL.test(text)) return { kind: "number", value: text, number: kind };
  if (typeof value === "number")
    return { kind: "number", value: text, number: Number.isInteger(value) ? "count" : "quantity" };
  return { kind: "text", text: plainWords(text) };
}

/** A side of an entry: an object of fields, a single value (plain text, a list, a number), or none. */
type Side = { fields: Record<string, unknown> } | { value: unknown } | null;

/** Reads one side of an entry from its text. */
function readSide(text: string | null): Side {
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return { fields: flatten(parsed as Record<string, unknown>, "", 1) };
    }
    return { value: parsed };
  } catch {
    return { value: text };
  }
}

/** Nested objects opened into dotted paths, two levels deep. */
function flatten(object: Record<string, unknown>, prefix: string, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const nested = typeof value === "object" && value !== null && !Array.isArray(value);
    if (nested && depth < MAX_DEPTH) Object.assign(out, flatten(value as Record<string, unknown>, path, depth + 1));
    else out[path] = value;
  }
  return out;
}

/** The last segment of a path, which decides how its value reads. */
const leaf = (path: string) => path.split(".").at(-1) ?? path;

/**
 * An audit entry's before and after as readable lines (click-through #58): one per field that
 * changed, labelled from the field's name, with ids named where the entry's `names` has them and
 * numbers kept as decimal strings for the screen to format. A side that is not JSON is one value.
 * With both sides, only the fields that differ are listed; with one side, every field it has.
 */
export function auditChanges(
  before: string | null,
  after: string | null,
  names: Readonly<Record<string, string>> = {},
): AuditChange[] {
  const was = readSide(before);
  const now = readSide(after);
  if (!was && !now) return [];
  if ((was && !("fields" in was)) || (now && !("fields" in now))) {
    const single = (side: Side) => (side ? auditValue("", "fields" in side ? side.fields : side.value, names) : null);
    return [{ key: "", label: auditLabel(""), before: single(was), after: single(now) }];
  }
  const oldFields = was && "fields" in was ? was.fields : {};
  const newFields = now && "fields" in now ? now.fields : {};
  const keys = [...new Set([...Object.keys(newFields), ...Object.keys(oldFields)])];
  return keys
    .filter((key) => !was || !now || JSON.stringify(oldFields[key]) !== JSON.stringify(newFields[key]))
    .map((key) => ({
      key,
      label: auditLabel(key),
      before: was ? auditValue(leaf(key), oldFields[key], names) : null,
      after: now ? auditValue(leaf(key), newFields[key], names) : null,
    }));
}
