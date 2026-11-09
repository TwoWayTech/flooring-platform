"use client";

import { useState } from "react";
import { importKind, type ImportKind } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import type { SampleTable } from "@/lib/api/contract";

const SKIP = "__skip";

/** A few rows of a table, as the database holds them. */
function SampleRows({ table }: { table: SampleTable }) {
  return (
    <div className="border-hairline overflow-x-auto rounded-md border">
      <table className="w-full text-xs">
        <caption className="sr-only">Sample rows of {table.name}</caption>
        <thead className="bg-raised/60 text-muted-foreground text-left">
          <tr>
            {table.columns.map((c) => (
              <th key={c} scope="col" className="px-2 py-1.5 font-medium whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-hairline divide-y">
          {table.sample.map((row) => (
            <tr key={row.join("|")}>
              {row.map((cell, i) => (
                <td key={table.columns[i]} className="px-2 py-1.5 whitespace-nowrap">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Table-to-record mapping (spec G2): each table the test found, its row count, what it becomes
 * (or left out), and a preview of its rows.
 */
export function SampleTables({
  tables,
  kinds,
  targets,
  onTarget,
}: {
  tables: readonly SampleTable[];
  kinds: readonly ImportKind[];
  targets: Record<string, ImportKind | null>;
  onTarget: (key: string, kind: ImportKind | null) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="divide-hairline border-hairline divide-y rounded-md border">
      {tables.map((t) => (
        <li key={t.key} className="flex flex-col gap-2 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="min-w-40 flex-1">
              <span className="block text-sm font-medium">{t.name}</span>
              <span className="text-muted-foreground text-xs">
                <Num value={t.rows} kind="count" /> rows
              </span>
            </span>
            <Select
              value={targets[t.key] ?? SKIP}
              onValueChange={(v) => onTarget(t.key, v === SKIP ? null : (v as ImportKind))}
            >
              <SelectTrigger className="w-56" aria-label={`What ${t.name} becomes`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SKIP}>Leave out</SelectItem>
                {kinds.map((k) => (
                  <SelectItem key={k} value={k}>
                    {importKind(k).label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={open === t.key}
              onClick={() => setOpen(open === t.key ? null : t.key)}
            >
              {open === t.key ? "Hide rows" : "Preview rows"}
            </Button>
          </div>
          {open === t.key ? <SampleRows table={t} /> : null}
        </li>
      ))}
    </ul>
  );
}
