"use client";

import { useCallback, useState } from "react";
import type { TablePrefs } from "./types";

const key = (tableId: string) => `fp-table:${tableId}`;

function load(tableId: string, initialHidden: string[]): TablePrefs {
  try {
    const stored = localStorage.getItem(key(tableId));
    if (stored) return JSON.parse(stored) as TablePrefs;
  } catch {
    // Fall back to the defaults below.
  }
  return { deltas: {}, hidden: initialHidden };
}

/** A table's per-person column decimals and hidden columns, remembered in this browser. */
export function useTablePrefs(tableId: string, initialHidden: string[]) {
  const [prefs, setPrefs] = useState<TablePrefs>(() => load(tableId, initialHidden));
  const update = useCallback(
    (change: (prefs: TablePrefs) => TablePrefs) =>
      setPrefs((current) => {
        const next = change(current);
        try {
          localStorage.setItem(key(tableId), JSON.stringify(next));
        } catch {
          // Preferences then last only for this visit.
        }
        return next;
      }),
    [tableId],
  );
  return [prefs, update] as const;
}
