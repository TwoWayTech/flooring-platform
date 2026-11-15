"use client";

import Link from "next/link";
import { useState } from "react";
import { Download, FileDown } from "lucide-react";
import { toast } from "sonner";
import {
  CATEGORY_LABELS,
  dec,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  type BusinessFilters,
  type BusinessReport,
  type BusinessRow,
  type BusinessSection,
  type ReportOptions,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Num } from "@workspace/ui/components/num";
import { Panel } from "@workspace/ui/components/panel";
import { Segmented } from "@workspace/ui/components/segmented";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet";
import { cn } from "@workspace/ui/lib/utils";
import { downloadText } from "@/components/data-table/csv";
import { ScrollRegion } from "@/components/scroll-region";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { Pick } from "@/features/hr/pick";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { saveBlob } from "@/lib/save-blob";
import { useFormatDate } from "@/lib/use-format-date";
import { CustomDates } from "./custom-dates";
import { customPeriod, editCustomPeriod } from "./custom-period";
import { shownAnswer, type KeyedAnswer } from "./report-answer";
import { ReportFallback } from "./report-fallback";

const ALL = "all";
type Preset = "month" | "last_month" | "quarter" | "ytd" | "custom";
const PRESETS: readonly (readonly [Preset, string])[] = [
  ["month", "This month"],
  ["last_month", "Last month"],
  ["quarter", "This quarter"],
  ["ytd", "This year"],
  ["custom", "Custom dates"],
];

function rangeFor(preset: Preset, today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const iso = (year: number, month: number, day: number) =>
    new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
  if (preset === "last_month") return { from: iso(y, m - 1, 1), to: iso(y, m, 0) };
  if (preset === "quarter") return { from: iso(y, Math.floor((m - 1) / 3) * 3 + 1, 1), to: today };
  if (preset === "ytd") return { from: iso(y, 1, 1), to: today };
  return { from: iso(y, m, 1), to: today };
}

/** Thin horizontal bars for one section, with the value beside each so colour is never the only cue (dataviz). */
function Bars({ section, onOpen }: { section: BusinessSection; onOpen: (row: BusinessRow) => void }) {
  const column = section.chartColumn!;
  const kind = section.columns.find((c) => c.id === column)?.kind ?? "money";
  const values = section.rows.map((r) => Math.abs(Number(r.values[column] ?? 0)));
  const largest = Math.max(...values, 1);
  return (
    <ul className="flex flex-col gap-1.5">
      {section.rows.map((row, i) => (
        <li key={row.id}>
          <button
            type="button"
            title={`${row.label}: ${row.values[column]}`}
            onClick={() => onOpen(row)}
            className="hover:bg-raised grid w-full grid-cols-[minmax(0,10rem)_minmax(0,1fr)_7rem] items-center gap-3 rounded-md px-1 py-1 text-left text-sm"
          >
            <span className="truncate">{row.label}</span>
            <span className="h-2" aria-hidden="true">
              {Number(row.values[column] ?? 0) > 0 ? (
                <span
                  className="bg-chart-1 block h-2 rounded-r-[4px]"
                  style={{ width: `${(values[i]! / largest) * 100}%` }}
                />
              ) : null}
            </span>
            <span className="text-right">
              <Num kind={kind} value={row.values[column] ?? "0"} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function SectionTable({ section, onOpen }: { section: BusinessSection; onOpen: (row: BusinessRow) => void }) {
  const cell = (row: BusinessRow, id: string, kind: "money" | "percent" | undefined) => {
    const raw = row.values[id];
    if (raw === undefined || raw === "") return null;
    const shown = row.kind ?? kind;
    return shown ? <Num kind={shown} value={raw} /> : raw;
  };
  return (
    <ScrollRegion label={section.title}>
      <table className="w-full min-w-[26rem] text-sm">
        <thead className="text-muted-foreground text-left text-xs">
          <tr>
            <th className="py-1 font-medium" />
            {section.columns.map((c) => (
              <th key={c.id} className="py-1 text-right font-medium">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {section.rows.map((row) => (
            <tr key={row.id} className="border-hairline border-t">
              <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                {row.records.length > 0 ? (
                  <button
                    type="button"
                    className="hover:text-brand-ink underline-offset-2 hover:underline"
                    onClick={() => onOpen(row)}
                  >
                    {row.label}
                  </button>
                ) : (
                  row.label
                )}
              </th>
              {section.columns.map((c) => (
                <td key={c.id} className="py-1.5 text-right">
                  {cell(row, c.id, c.kind)}
                </td>
              ))}
            </tr>
          ))}
          {section.total ? (
            <tr className="border-hairline border-t font-medium">
              <th scope="row" className="py-1.5 pr-3 text-left font-medium">
                {section.total.label}
              </th>
              {section.columns.map((c) => (
                <td key={c.id} className="py-1.5 text-right">
                  {cell(section.total!, c.id, c.kind)}
                </td>
              ))}
            </tr>
          ) : null}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

function ReportSection({ section, onOpen }: { section: BusinessSection; onOpen: (row: BusinessRow) => void }) {
  const [mode, setMode] = useState<"chart" | "table">(section.chartColumn ? "chart" : "table");
  return (
    <Panel
      title={section.title}
      actions={
        section.chartColumn ? (
          <Segmented
            label={`${section.title} view`}
            value={mode}
            options={[
              ["chart", "Chart"],
              ["table", "Table"],
            ]}
            onChange={(v) => setMode(v as "chart" | "table")}
          />
        ) : null
      }
    >
      <div className="flex flex-col gap-2">
        {section.note ? <p className="text-muted-foreground text-sm">{section.note}</p> : null}
        {section.rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing in this period.</p>
        ) : mode === "chart" && section.chartColumn ? (
          <Bars section={section} onOpen={onOpen} />
        ) : (
          <SectionTable section={section} onOpen={onOpen} />
        )}
      </div>
    </Panel>
  );
}

/** Every section as one CSV: the same rows the screen shows. */
function toCsvText(report: BusinessReport): string {
  const quote = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = report.sections.flatMap((s) => {
    const head = ["Section", "Line", ...s.columns.map((c) => c.header)];
    const rows = [...s.rows, ...(s.total ? [s.total] : [])].map((r) => [
      s.title,
      r.label,
      ...s.columns.map((c) => r.values[c.id] ?? ""),
    ]);
    return [head, ...rows, []];
  });
  return lines.map((l) => l.map(quote).join(",")).join("\n");
}

/**
 * The business report (spec F2): one report with sections, comparison, filters, drill-down and
 * matching exports. It covers the whole company, so the server opens it only for data scope `all`
 * (ADR 0055 S1). The location, salesperson and vendor choices come from `options`, so only ids the
 * server knows are sent, and sections the person may not see are not in the answer at all (S7).
 * While a new answer loads the last sections stay dimmed and the exports wait, so a CSV or PDF
 * always matches the dates it prints. Custom dates the server would refuse (S8) are explained
 * beside the inputs and never sent, so the last figures stay.
 */
export function BusinessReportView({ options, onRefresh }: { options: ReportOptions; onRefresh: () => void }) {
  const { company, settings } = useWorkspace();
  const formatDate = useFormatDate();
  const today = api.today();
  const [preset, setPreset] = useState<Preset>("last_month");
  const [custom, setCustom] = useState(() => customPeriod({ from: `${today.slice(0, 4)}-01-01`, to: today }));
  const [locationIds, setLocations] = useState<string[]>([]);
  const [productCategory, setCategory] = useState(ALL);
  const [expenseCategory, setExpenseCategory] = useState(ALL);
  const [salesRepId, setRep] = useState(ALL);
  const [supplierId, setSupplier] = useState(ALL);
  const [drill, setDrill] = useState<{ title: string; row: BusinessRow } | null>(null);
  // Custom dates the API would refuse (ADR 0055 S8) are explained beside the inputs and never sent:
  // the report stays on the last pair that worked, so a typo never wipes the figures.
  const range = preset === "custom" ? custom.applied : rangeFor(preset, today);
  // Only choices the server still lists are sent, so a stale pick reads as "all" instead of a refusal.
  const listed = (id: string, choices: readonly { id: string }[]) => choices.some((c) => c.id === id);
  const locations = locationIds.filter((id) => listed(id, options.locations));
  const rep = listed(salesRepId, options.salespeople) ? salesRepId : null;
  const vendor = listed(supplierId, options.vendors) ? supplierId : null;
  const params: BusinessFilters = {
    ...range,
    locationIds: locations,
    productCategory: productCategory === ALL ? null : productCategory,
    expenseCategory: expenseCategory === ALL ? null : expenseCategory,
    salesRepId: rep,
    supplierId: vendor,
  };
  const request = JSON.stringify(params);
  const query = useApiQuery(
    async (client): Promise<KeyedAnswer<BusinessReport>> => ({
      reportKey: "business",
      request,
      report: await client.businessReport(params),
    }),
    [request],
  );
  // While a new answer loads the last sections stay, dimmed, and the exports wait (ADR 0055 "Also safer").
  const { report, busy } = shownAnswer(query.data, "business", request);
  const filters = `${formatDate(range.from)} to ${formatDate(range.to)}, compared with the same length before`;
  const stem = `business-report-${today}`;

  function exportCsv() {
    if (!report || busy) return;
    downloadText(`${stem}.csv`, toCsvText(report));
  }

  async function exportPdf() {
    if (!report || busy) return;
    const [{ pdf }, { BusinessReportPdf }] = await Promise.all([
      import("@react-pdf/renderer"),
      import("./business-report-pdf"),
    ]);
    saveBlob(
      await pdf(
        <BusinessReportPdf report={report} company={company.name} filters={filters} settings={settings.numbers} />,
      ).toBlob(),
      `${stem}.pdf`,
    );
    toast.success(`${stem}.pdf downloaded`);
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Panel
        title="Business report"
        actions={
          options.exports.includes("business") ? (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={!report || busy} onClick={exportCsv}>
                <Download />
                Export CSV
              </Button>
              <Button variant="outline" size="sm" disabled={!report || busy} onClick={() => void exportPdf()}>
                <FileDown />
                Export PDF
              </Button>
            </div>
          ) : null
        }
      >
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Pick label="Period" value={preset} onChange={setPreset} options={PRESETS} />
            {preset === "custom" ? (
              <CustomDates period={custom} onChange={(change) => setCustom((c) => editCustomPeriod(c, change))} />
            ) : null}
            <Pick
              label="Product category"
              value={productCategory}
              onChange={setCategory}
              options={[[ALL, "All product categories"], ...Object.entries(CATEGORY_LABELS)]}
            />
            <Pick
              label="Expense category"
              value={expenseCategory}
              onChange={setExpenseCategory}
              options={[
                [ALL, "All expense categories"],
                ...EXPENSE_CATEGORIES.map((c) => [c, EXPENSE_CATEGORY_LABELS[c]] as const),
              ]}
            />
            <Pick
              label="Salesperson"
              value={rep ?? ALL}
              onChange={setRep}
              options={[[ALL, "All salespeople"], ...options.salespeople.map((u) => [u.id, u.name] as const)]}
            />
            <Pick
              label="Vendor"
              value={vendor ?? ALL}
              onChange={setSupplier}
              options={[[ALL, "All vendors"], ...options.vendors.map((s) => [s.id, s.name] as const)]}
            />
          </div>
          {options.locations.length > 0 ? (
            <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
              <legend className="text-muted-foreground mb-1 text-xs">Locations (none ticked means all)</legend>
              {options.locations.map((l) => (
                <label key={l.id} className="flex items-center gap-2">
                  <Checkbox
                    aria-label={l.name}
                    checked={locations.includes(l.id)}
                    onCheckedChange={(on) =>
                      setLocations(on ? [...locations, l.id] : locations.filter((x) => x !== l.id))
                    }
                  />
                  {l.name}
                </label>
              ))}
            </fieldset>
          ) : null}
          <p className="text-muted-foreground text-sm">{filters}.</p>
        </div>
      </Panel>
      {report ? (
        <div
          role="group"
          aria-label="Business report figures"
          aria-busy={busy || undefined}
          className={cn("flex min-w-0 flex-col gap-6", busy && "opacity-60")}
        >
          {report.sections.map((section) => (
            <ReportSection
              key={section.key}
              section={section}
              onOpen={(row) => setDrill({ title: section.title, row })}
            />
          ))}
        </div>
      ) : (
        <ReportFallback query={query} className="h-96" label="Loading the business report" onRefresh={onRefresh} />
      )}
      <Sheet open={!!drill} onOpenChange={(o) => !o && setDrill(null)}>
        <SheetContent className="bg-surface w-full overflow-y-auto sm:max-w-md">
          {drill ? (
            <>
              <SheetHeader>
                <SheetTitle>{drill.row.label}</SheetTitle>
                <SheetDescription>{drill.title}: the records behind this figure.</SheetDescription>
              </SheetHeader>
              {drill.row.recordCount !== undefined ? (
                <p className="text-muted-foreground px-4 text-sm">
                  Showing the latest <Num kind="count" value={String(drill.row.records.length)} /> of{" "}
                  <Num kind="count" value={String(drill.row.recordCount)} /> records.
                </p>
              ) : null}
              <ul className="divide-hairline flex flex-col divide-y px-4 pb-6 text-sm">
                {drill.row.records.length === 0 ? (
                  <li className="text-muted-foreground py-2">This figure is worked out from other lines.</li>
                ) : null}
                {drill.row.records.map((r, i) => (
                  <li key={`${r.label}-${i}`} className="flex justify-between gap-3 py-2">
                    <span>
                      {r.href ? (
                        <Link className="text-brand-ink underline-offset-2 hover:underline" href={r.href}>
                          {r.label}
                        </Link>
                      ) : (
                        r.label
                      )}
                      <span className="text-muted-foreground">
                        {" "}
                        {r.date.length === 10 ? formatDate(r.date) : r.date}
                      </span>
                    </span>
                    <Num kind="money" value={dec(r.amount).toString()} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
