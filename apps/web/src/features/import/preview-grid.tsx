import { Fragment } from "react";
import { CircleMinus, CirclePlus, RefreshCw, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ImportKindDef, PlannedRow, RowAction } from "@workspace/shared";
import { StatusPill, type StatusTone } from "@workspace/ui/components/status-pill";
import { cn } from "@workspace/ui/lib/utils";

/** How each row's result reads in the preview: an icon and a word, never color alone. */
export const ACTION_PILL: Record<RowAction, { tone: StatusTone; icon: LucideIcon; label: string }> = {
  create: { tone: "success", icon: CirclePlus, label: "Creates" },
  update: { tone: "brand", icon: RefreshCw, label: "Updates" },
  skip: { tone: "neutral", icon: CircleMinus, label: "Skips" },
  error: { tone: "danger", icon: TriangleAlert, label: "Error" },
};

/**
 * The file read back as a sheet (spec G1 "errors shown per row and cell"): the row numbers of
 * the file, the mapped columns, each row's result, and a wavy underline on every cell with a
 * problem. The problems themselves are written under the row, so they never live only in color.
 */
export function PreviewGrid({
  def,
  rows,
  mapped,
}: {
  def: ImportKindDef;
  rows: readonly PlannedRow[];
  mapped: Set<string>;
}) {
  const fields = def.fields.filter((f) => mapped.has(f.key));
  const labelOf = (key: string | null) => fields.find((f) => f.key === key)?.label ?? "Row";
  return (
    <div className="border-hairline max-h-[32rem] overflow-auto rounded-md border">
      <table className="w-full text-sm">
        <caption className="sr-only">Preview of the file with each row&apos;s result</caption>
        <thead className="bg-raised text-muted-foreground sticky top-0 z-10 text-left text-xs">
          <tr>
            <th scope="col" className="w-12 px-2 py-2 text-right font-medium">
              Row
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Result
            </th>
            {fields.map((f) => (
              <th key={f.key} scope="col" className="px-2 py-2 font-medium whitespace-nowrap">
                {f.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const pill = ACTION_PILL[row.action];
            const bad = new Set(row.problems.map((p) => p.field));
            return (
              <Fragment key={row.line}>
                <tr className={cn("border-hairline border-t", row.action === "error" && "bg-danger/5")}>
                  <th scope="row" className="text-muted-foreground px-2 py-1.5 text-right font-normal tabular-nums">
                    {row.line}
                  </th>
                  <td className="px-2 py-1.5">
                    <StatusPill tone={pill.tone} icon={pill.icon} label={pill.label} />
                  </td>
                  {fields.map((f) => (
                    <td
                      key={f.key}
                      className={cn(
                        "max-w-48 truncate px-2 py-1.5 whitespace-nowrap",
                        bad.has(f.key) &&
                          "text-danger-ink decoration-danger underline decoration-wavy underline-offset-4",
                      )}
                    >
                      {row.cells[f.key] ||
                        (bad.has(f.key) ? <span className="text-muted-foreground">(empty)</span> : null)}
                    </td>
                  ))}
                </tr>
                {row.problems.length || row.note ? (
                  <tr className={cn(row.action === "error" && "bg-danger/5")}>
                    <td />
                    <td colSpan={fields.length + 1} className="px-2 pb-2 text-xs">
                      <ul className="flex flex-col gap-0.5">
                        {row.problems.map((p) => (
                          <li key={`${p.field}-${p.message}`} className="text-danger-ink">
                            {labelOf(p.field)}: {p.message}
                          </li>
                        ))}
                        {row.note ? <li className="text-muted-foreground">{row.note}</li> : null}
                      </ul>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
