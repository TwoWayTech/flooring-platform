"use client";

import { useState } from "react";
import { dryRunSummary, type ColumnMapping, type ImportKindDef, type RowAction } from "@workspace/shared";
import { Label } from "@workspace/ui/components/label";
import { Num } from "@workspace/ui/components/num";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { Switch } from "@workspace/ui/components/switch";
import type { ImportPreview } from "@/lib/api/contract";
import { ACTION_PILL, PreviewGrid } from "./preview-grid";

/** The preview shows this many rows (spec G1 step 6). */
const PREVIEW_ROWS = 50;
const ORDER: RowAction[] = ["create", "update", "skip", "error"];

/**
 * Step 4 (spec G1): the dry run in one sentence and per action, then the first 50 rows of the
 * file with their results. Rows with problems can be shown alone, so a long file's errors are
 * easy to find; nothing is written yet.
 */
export function CheckStep({
  def,
  preview,
  mapping,
}: {
  def: ImportKindDef;
  preview: ImportPreview;
  mapping: ColumnMapping;
}) {
  const [onlyProblems, setOnlyProblems] = useState(preview.counts.error > 0);
  const rows = onlyProblems ? preview.rows.filter((r) => r.action === "error") : preview.rows;
  const shown = rows.slice(0, PREVIEW_ROWS);
  const mapped = new Set(Object.entries(mapping).flatMap(([key, header]) => (header ? [key] : [])));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium" aria-live="polite">
          {dryRunSummary(preview.counts)}
        </p>
        <ul className="flex flex-wrap gap-2" aria-label="Rows by result">
          {ORDER.map((action) => (
            <li key={action} className="flex items-center gap-1.5 text-sm">
              <StatusPill {...ACTION_PILL[action]} />
              <Num value={preview.counts[action]} kind="count" />
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">
          {rows.length > PREVIEW_ROWS ? (
            <>
              The first <Num value={PREVIEW_ROWS} kind="count" /> of <Num value={rows.length} kind="count" /> rows.
            </>
          ) : (
            <>
              All <Num value={rows.length} kind="count" /> rows.
            </>
          )}
        </p>
        <div className="flex items-center gap-2">
          <Switch id="only-problems" checked={onlyProblems} onCheckedChange={setOnlyProblems} />
          <Label htmlFor="only-problems" className="text-sm">
            Only rows with errors
          </Label>
        </div>
      </div>
      {shown.length ? (
        <PreviewGrid def={def} rows={shown} mapped={mapped} />
      ) : (
        <p className="text-muted-foreground text-sm">No rows have errors.</p>
      )}
    </div>
  );
}
