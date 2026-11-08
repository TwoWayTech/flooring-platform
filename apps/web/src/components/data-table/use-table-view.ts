"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { viewFromParams, viewToParams, type FilterKind, type TableView } from "@workspace/shared";
import { WorkspaceContext } from "@/components/workspace/workspace-context";

const storageKey = (userId: string, tableId: string) => `fp-table-view:${userId}:${tableId}`;

function readLastView(key: string): TableView | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as TableView) : null;
  } catch {
    return null;
  }
}

function writeLastView(key: string, view: TableView) {
  try {
    localStorage.setItem(key, JSON.stringify(view));
  } catch {
    // Without storage the view still lives in the URL.
  }
}

/**
 * A table's search, sort and filters, kept in the URL so links and the back button keep them
 * (spec A2). Each person's last view of each table is remembered in this browser and restored
 * when they open the table without a view in the address.
 */
export function useTableView(
  tableId: string,
  kinds: Readonly<Record<string, FilterKind>>,
  initialSort: TableView["sort"],
): [TableView, (next: TableView) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const userId = useContext(WorkspaceContext)?.user.id ?? "platform";
  const key = storageKey(userId, tableId);
  const fromUrl = useMemo(() => viewFromParams(tableId, params.entries(), kinds), [tableId, params, kinds]);

  const apply = useCallback(
    (next: TableView) => {
      const query = new URLSearchParams(params);
      for (const name of [...query.keys()]) if (name.startsWith(`${tableId}.`)) query.delete(name);
      for (const [name, value] of viewToParams(tableId, next)) query.set(name, value);
      const text = query.toString();
      router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
      writeLastView(key, next);
    },
    [params, pathname, router, tableId, key],
  );

  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (fromUrl) return writeLastView(key, fromUrl);
    const last = readLastView(key);
    if (last) apply(last);
  }, [fromUrl, key, apply]);

  return [fromUrl ?? { search: "", sort: initialSort, filters: {} }, apply];
}
