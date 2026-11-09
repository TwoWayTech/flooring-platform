import type { StoredOverlay, StoredRecords } from "./overlay";

/** A saved record as the browser kept it: any shape, read field by field. */
export type Row = Record<string, unknown>;

/** Applies a change to every saved (non-deleted) record of one collection. */
export function mapRecords(records: StoredOverlay["records"], name: string, change: (row: Row) => Row) {
  const saved = records[name];
  if (!saved) return records;
  const next: StoredRecords = {};
  for (const [id, row] of Object.entries(saved)) next[id] = row === null ? null : change(row as Row);
  return { ...records, [name]: next };
}
