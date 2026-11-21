"use client";

import { useState, type ReactNode } from "react";
import { Download, FileDown } from "lucide-react";
import { toast } from "sonner";
import {
  CATEGORY_LABELS,
  PAYMENT_METHOD_LABELS,
  REPORT_CATALOG,
  REPORT_CUSTOMER_SEARCH_MAX,
  REPORT_RANGE_KEYS,
  REPORT_RANGES,
  HUB_LOCATION_FILTERS,
  hubLocationsOf,
  type PaymentMethod,
  type ProductCategory,
  type Report,
  type ReportKey,
  type ReportOptions,
  type ReportRange,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Num } from "@workspace/ui/components/num";
import { Panel } from "@workspace/ui/components/panel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { cn } from "@workspace/ui/lib/utils";
import { downloadText, toCsv } from "@/components/data-table/csv";
import { ScrollRegion } from "@/components/scroll-region";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import type { ApiClient } from "@/lib/api/contract";
import { useApiQuery } from "@/lib/api/use-api";
import { saveBlob } from "@/lib/save-blob";
import { useFormatDate } from "@/lib/use-format-date";
import { presentReport } from "./present-report";
import { shownAnswer, type KeyedAnswer } from "./report-answer";
import { ReportFallback } from "./report-fallback";
import { useDebouncedValue } from "./use-debounced-value";

/** The three reports beside the Business report (spec rule 24); the trial balance has its own view. */
export type HubReportKey = Exclude<ReportKey, "business" | "trial-balance">;

/** Whether a report the server lists is one of the three hub reports. */
export function isHubReport(key: ReportKey): key is HubReportKey {
  return key !== "business" && key !== "trial-balance";
}

const ALL = "all";
/** How long the customer search waits for typing to pause before it asks the API. */
const CUSTOMER_PAUSE_MS = 300;

/** Every filter the hub offers; each report sends only its own (rule 24). */
interface HubFilters {
  range: ReportRange;
  locationId: string | null;
  category: ProductCategory | null;
  method: PaymentMethod | null;
  customer: string;
}

interface HubReportSpec {
  /** Category appears only on Sales by category (rule 24). */
  categories: boolean;
  /** Method and Customer appear only on Payments received (rule 24). */
  payments: boolean;
  fetch: (client: ApiClient, filters: HubFilters) => Promise<Report>;
}

/** How each hub report asks the API for its rows (ADR 0055): the server scopes and strips them. */
const HUB_REPORTS: Record<HubReportKey, HubReportSpec> = {
  pnl: {
    categories: false,
    payments: false,
    fetch: (client, f) => client.pnlReport({ range: f.range, locationId: f.locationId }),
  },
  sales: {
    categories: true,
    payments: false,
    fetch: (client, f) =>
      client.salesByCategoryReport({ range: f.range, locationId: f.locationId, category: f.category }),
  },
  payments: {
    categories: false,
    payments: true,
    fetch: (client, f) =>
      client.paymentsReport({ range: f.range, locationId: f.locationId, method: f.method, customer: f.customer }),
  },
};

/** Sales by category leaves out Services, which are labour, not a product category (rule 24). */
const SALES_CATEGORIES = (Object.keys(CATEGORY_LABELS) as ProductCategory[]).filter((c) => c !== "service");

function Filter({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function ReportTable({
  report,
  label,
  busy,
  everywhere,
}: {
  report: Report;
  label: string;
  busy: boolean;
  /** The place filter's every-place option, e.g. "All locations". */
  everywhere: string;
}) {
  const totals = report.totals;
  return (
    <ScrollRegion label={label} busy={busy} className={cn("border-hairline rounded-md border", busy && "opacity-60")}>
      <table className="w-full text-sm">
        <thead className="bg-raised text-muted-foreground text-xs">
          <tr>
            {report.columns.map((c) => (
              <th
                key={c.id}
                scope="col"
                className={cn("h-9 px-3 font-medium whitespace-nowrap", c.kind ? "text-right" : "text-left")}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.rows.length === 0 ? (
            <tr>
              <td colSpan={report.columns.length} className="text-muted-foreground h-16 px-3">
                No figures for these filters. Choose a wider date range or {everywhere.toLowerCase()}.
              </td>
            </tr>
          ) : null}
          {report.rows.map((row, i) => (
            <tr key={i} className="border-hairline border-t">
              {report.columns.map((c) => (
                <td key={c.id} className={cn("h-9 px-3 whitespace-nowrap", c.kind && "text-right")}>
                  {c.kind ? <Num kind={c.kind} value={row[c.id] ?? "0"} /> : row[c.id]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totals ? (
          <tfoot>
            <tr className="border-hairline border-t-2 font-semibold">
              {report.columns.map((c) => {
                const value = totals[c.id];
                return (
                  <td key={c.id} className={cn("h-10 px-3 whitespace-nowrap", c.kind && "text-right")}>
                    {c.kind && value !== undefined ? <Num kind={c.kind} value={value} /> : value}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </ScrollRegion>
  );
}

/**
 * One of the three hub reports (spec rule 24): Profit and loss, Sales by category or Payments
 * received, read from the API with the filters the person picked. The rows hold only what the
 * server lets this person see (ADR 0055 S2, S6, S18), and the table, CSV and PDF print those same
 * rows. Export shows only when the server lists the report in `exports` (S15).
 */
export function HubReportView({
  reportKey,
  options,
  onRefresh,
}: {
  reportKey: HubReportKey;
  options: ReportOptions;
  onRefresh: () => void;
}) {
  const { company, settings } = useWorkspace();
  const formatDate = useFormatDate();
  const [range, setRange] = useState<ReportRange>("12m");
  const [place, setPlace] = useState(ALL);
  const [category, setCategory] = useState<ProductCategory | typeof ALL>(ALL);
  const [method, setMethod] = useState<PaymentMethod | typeof ALL>(ALL);
  const [customerQuery, setCustomerQuery] = useState("");
  const customer = useDebouncedValue(customerQuery, CUSTOMER_PAUSE_MS);
  const spec = HUB_REPORTS[reportKey];
  const title = REPORT_CATALOG[reportKey].label;
  const placeFilter = HUB_LOCATION_FILTERS[reportKey];
  const places = hubLocationsOf(reportKey, options.locations);
  // Only a place the server still lists is sent, so a stale pick reads as every place.
  const chosen = places.find((l) => l.id === place) ?? null;
  const filters: HubFilters = {
    range,
    locationId: chosen?.id ?? null,
    category: spec.categories && category !== ALL ? category : null,
    method: spec.payments && method !== ALL ? method : null,
    customer: spec.payments ? customer.trim() : "",
  };
  const request = JSON.stringify([reportKey, filters]);
  const query = useApiQuery(
    async (client): Promise<KeyedAnswer<Report>> => ({ reportKey, request, report: await spec.fetch(client, filters) }),
    [request],
  );
  const shown = shownAnswer(query.data, reportKey, request);
  const busy = shown.busy;
  const report = shown.report ? presentReport(shown.report, formatDate) : null;
  const paymentFilters = spec.payments
    ? `${filters.method ? `, ${PAYMENT_METHOD_LABELS[filters.method]}` : ""}${filters.customer ? `, customers matching “${filters.customer}”` : ""}`
    : "";
  const filterText = `${REPORT_RANGES[range]}, ${chosen ? chosen.name : placeFilter.all.toLowerCase()}${filters.category ? `, ${CATEGORY_LABELS[filters.category]}` : ""}${paymentFilters}.`;
  const fileStem = `${reportKey}-${api.today()}`;
  const canExport = options.exports.includes(reportKey);

  function exportCsv() {
    if (!report || busy) return;
    const rows = report.totals ? [...report.rows, report.totals] : report.rows;
    downloadText(
      `${fileStem}.csv`,
      toCsv(
        rows,
        report.columns.map((c) => ({
          id: c.id,
          header: c.header,
          value: (r: Record<string, string>) => r[c.id] ?? "",
        })),
      ),
    );
  }

  async function exportPdf() {
    if (!report || busy) return;
    const [{ pdf }, { ReportPdf }] = await Promise.all([import("@react-pdf/renderer"), import("./report-pdf")]);
    const blob = await pdf(
      <ReportPdf report={report} company={company.name} filters={filterText} settings={settings.numbers} />,
    ).toBlob();
    saveBlob(blob, `${fileStem}.pdf`);
    toast.success(`${fileStem}.pdf downloaded`);
  }

  return (
    <Panel
      title={title}
      actions={
        canExport ? (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!report || busy}>
              <Download />
              Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => void exportPdf()} disabled={!report || busy}>
              <FileDown />
              Export PDF
            </Button>
          </div>
        ) : null
      }
      bodyClassName="flex flex-col gap-4"
    >
      <div className="flex flex-wrap gap-3">
        <Filter label="Dates">
          <Select value={range} onValueChange={(v) => setRange(v as ReportRange)}>
            <SelectTrigger className="h-9 w-44" aria-label="Dates">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REPORT_RANGE_KEYS.map((r) => (
                <SelectItem key={r} value={r}>
                  {REPORT_RANGES[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Filter>
        <Filter label={placeFilter.label}>
          <Select value={chosen ? chosen.id : ALL} onValueChange={setPlace}>
            <SelectTrigger className="bg-surface h-9 w-52" aria-label={placeFilter.label}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{placeFilter.all}</SelectItem>
              {places.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Filter>
        {spec.categories ? (
          <Filter label="Category">
            <Select value={category} onValueChange={(v) => setCategory(v as ProductCategory | typeof ALL)}>
              <SelectTrigger className="h-9 w-52" aria-label="Category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All categories</SelectItem>
                {SALES_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Filter>
        ) : null}
        {spec.payments ? (
          <>
            <Filter label="Method">
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod | typeof ALL)}>
                <SelectTrigger className="h-9 w-48" aria-label="Method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All methods</SelectItem>
                  {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                    <SelectItem key={m} value={m}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Filter>
            <Filter label="Customer">
              <Input
                aria-label="Customer"
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
                maxLength={REPORT_CUSTOMER_SEARCH_MAX}
                placeholder="Any customer"
                className="h-9 w-52"
              />
            </Filter>
          </>
        ) : null}
      </div>
      {report ? (
        <ReportTable report={report} label={`${title} table`} busy={busy} everywhere={placeFilter.all} />
      ) : (
        <ReportFallback query={query} className="h-64" label="Loading report" onRefresh={onRefresh} />
      )}
      <p className="text-muted-foreground text-xs">{filterText} Figures are computed from documents.</p>
    </Panel>
  );
}
