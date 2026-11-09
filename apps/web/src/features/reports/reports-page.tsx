"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Download, FileDown } from "lucide-react";
import { toast } from "sonner";
import {
  addDays,
  boxedStock,
  last12Months,
  locationName,
  PAYMENT_METHOD_LABELS,
  SENSITIVE,
  type PaymentMethod,
  type PermissionKey,
  type ProductCategory,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Num } from "@workspace/ui/components/num";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Panel } from "@workspace/ui/components/panel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { cn } from "@workspace/ui/lib/utils";
import { ScrollRegion } from "@/components/scroll-region";
import { downloadText, toCsv } from "@/components/data-table/csv";
import { NoAccess } from "@/components/no-access";
import { QueryFallback } from "@/components/query-fallback";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { ALL_WAREHOUSES, ALL_WAREHOUSES_OPTION, WarehouseSelect } from "@/components/warehouse-select";
import { useApiQuery } from "@/lib/api/use-api";
import { saveBlob } from "@/features/invoices/payments/file-viewer-dialog";
import { CATEGORY_LABELS } from "@/lib/labels";
import {
  inventoryReport,
  paymentsReport,
  pnlReport,
  salesByCategoryReport,
  salesTaxReport,
  type Report,
  type ReportInput,
} from "./report-model";

/** The reports, the permission each needs to view and to export, and how each is built. */
const REPORTS = {
  pnl: {
    label: "Profit and loss",
    view: "reports.financial.view",
    export: "reports.financial.export",
    build: pnlReport,
    categories: false,
  },
  sales: {
    label: "Sales by category",
    view: "reports.sales.view",
    export: "reports.sales.export",
    build: salesByCategoryReport,
    categories: true,
  },
  tax: {
    label: "Sales tax by jurisdiction",
    view: "reports.tax.view",
    export: "reports.tax.export",
    build: salesTaxReport,
    categories: false,
  },
  inventory: {
    label: "Inventory valuation",
    view: "reports.inventory.view",
    export: "reports.inventory.export",
    build: inventoryReport,
    categories: true,
  },
  payments: {
    label: "Payments received",
    view: "reports.financial.view",
    export: "reports.financial.export",
    build: paymentsReport,
    categories: false,
  },
} satisfies Record<
  string,
  { label: string; view: PermissionKey; export: PermissionKey; build: (i: ReportInput) => Report; categories: boolean }
>;
type ReportKey = keyof typeof REPORTS;

const RANGES = { "12m": "Last 12 months", "3m": "Last 3 months", "1m": "This month", ytd: "This year" } as const;
type Range = keyof typeof RANGES;

/** Months covered by a date range, ending with this month. */
function monthsFor(range: Range, today: string): string[] {
  const all = last12Months(today);
  if (range === "3m") return all.slice(-3);
  if (range === "1m") return all.slice(-1);
  if (range === "ytd") return all.filter((m) => m.startsWith(today.slice(0, 4)));
  return all;
}

function Filter({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/**
 * The reports hub (spec Tier 2): P&L, sales by category, sales tax by jurisdiction, inventory
 * valuation and payments received (Appendix A), with date, warehouse, category, method and
 * customer filters and real CSV and PDF exports.
 */
export function ReportsPage() {
  const can = useCan();
  const router = useRouter();
  const params = useSearchParams();
  const { company, settings } = useWorkspace();
  const [range, setRange] = useState<Range>("12m");
  const [warehouse, setWarehouse] = useState(ALL_WAREHOUSES);
  const [category, setCategory] = useState("all");
  const [method, setMethod] = useState<PaymentMethod | "all">("all");
  const [customerQuery, setCustomerQuery] = useState("");
  const data = useApiQuery(async (client) => {
    const [invoices, expenses, products, rolls, stockMovements, locations, payments, customers] = await Promise.all([
      client.list("invoices"),
      client.list("expenses"),
      client.list("products"),
      client.list("rolls"),
      client.list("stockMovements"),
      client.list("locations"),
      client.list("payments"),
      client.list("customers"),
    ]);
    return { invoices, expenses, products, rolls, stockMovements, locations, payments, customers };
  }, []);

  const allowed = (Object.keys(REPORTS) as ReportKey[]).filter((k) => can(REPORTS[k].view));
  if (allowed.length === 0) return <NoAccess />;
  const requested = params.get("report") as ReportKey | null;
  const key = requested && allowed.includes(requested) ? requested : allowed[0]!;
  const spec = REPORTS[key];
  const today = api.today();
  const months = monthsFor(range, today);
  const warehouseId = warehouse === ALL_WAREHOUSES ? null : warehouse;

  let report: Report | null = null;
  if (data.status === "ready") {
    const from = `${months[0]}-01`;
    const invoices = data.data.invoices.filter(
      (i) => i.issuedAt >= from && i.issuedAt <= addDays(today, 1) && (!warehouseId || i.locationId === warehouseId),
    );
    const expenses = data.data.expenses.filter((e) => e.at >= from);
    // Payments count on their payment date, in the warehouse of their invoice (Appendix A: cash dates).
    const shipsFrom = new Map(data.data.invoices.map((i) => [i.id, i.locationId]));
    const payments = data.data.payments.filter(
      (p) => p.date >= from && p.date <= today && (!warehouseId || shipsFrom.get(p.invoiceId) === warehouseId),
    );
    report = spec.build({
      months,
      invoices,
      expenses,
      products: data.data.products,
      rolls: data.data.rolls.filter((r) => !warehouseId || r.locationId === warehouseId),
      boxed: boxedStock(data.data.stockMovements, warehouseId),
      category: spec.categories && category !== "all" ? category : null,
      showCost: can(SENSITIVE.productCost),
      payments,
      customers: data.data.customers,
      method: method === "all" ? null : method,
      customerQuery,
      dateFormat: settings.localization.region.dateFormat,
    });
  }
  const warehouseLabel =
    data.status === "ready" && warehouseId ? locationName(data.data.locations, warehouseId) : "all warehouses";
  const paymentFilters =
    key === "payments"
      ? `${method === "all" ? "" : `, ${PAYMENT_METHOD_LABELS[method]}`}${customerQuery.trim() ? `, customers matching “${customerQuery.trim()}”` : ""}`
      : "";
  const filters = `${RANGES[range]}, ${warehouseLabel}${spec.categories && category !== "all" ? `, ${CATEGORY_LABELS[category as ProductCategory]}` : ""}${paymentFilters}.`;
  const fileStem = `${key}-${today}`;

  function exportCsv() {
    if (!report) return;
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
    if (!report) return;
    const [{ pdf }, { ReportPdf }] = await Promise.all([import("@react-pdf/renderer"), import("./report-pdf")]);
    const blob = await pdf(
      <ReportPdf report={report} company={company.name} filters={filters} settings={settings.numbers} />,
    ).toBlob();
    saveBlob(blob, `${fileStem}.pdf`);
    toast.success(`${fileStem}.pdf downloaded`);
  }

  return (
    <>
      <PageHeader title="Reports" />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Reports" className="scrollbar-none -mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          <ul className="flex gap-1 lg:flex-col">
            {allowed.map((k) => (
              <li key={k}>
                <button
                  type="button"
                  onClick={() => router.replace(`/reports?report=${k}`)}
                  aria-current={k === key ? "page" : undefined}
                  className={cn(
                    "flex h-9 w-full items-center rounded-md px-2.5 text-left text-sm whitespace-nowrap",
                    k === key ? "bg-brand-soft text-brand-ink font-medium" : "hover:bg-raised",
                  )}
                >
                  {REPORTS[k].label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <Panel
          title={spec.label}
          actions={
            can(spec.export) ? (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={exportCsv} disabled={!report}>
                  <Download />
                  Export CSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => void exportPdf()} disabled={!report}>
                  <FileDown />
                  Export PDF
                </Button>
              </div>
            ) : null
          }
          bodyClassName="flex flex-col gap-4"
        >
          <div className="flex flex-wrap gap-3">
            {key !== "inventory" ? (
              <Filter label="Dates">
                <Select value={range} onValueChange={(v) => setRange(v as Range)}>
                  <SelectTrigger className="h-9 w-44" aria-label="Dates">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(RANGES) as Range[]).map((r) => (
                      <SelectItem key={r} value={r}>
                        {RANGES[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Filter>
            ) : null}
            {data.status === "ready" ? (
              <Filter label="Warehouse">
                <WarehouseSelect
                  label="Warehouse"
                  extraOption={ALL_WAREHOUSES_OPTION}
                  locations={data.data.locations}
                  value={warehouse}
                  onChange={setWarehouse}
                />
              </Filter>
            ) : null}
            {spec.categories ? (
              <Filter label="Category">
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="h-9 w-52" aria-label="Category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {(Object.keys(CATEGORY_LABELS) as ProductCategory[])
                      .filter((c) => c !== "service")
                      .map((c) => (
                        <SelectItem key={c} value={c}>
                          {CATEGORY_LABELS[c]}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Filter>
            ) : null}
            {key === "payments" ? (
              <>
                <Filter label="Method">
                  <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod | "all")}>
                    <SelectTrigger className="h-9 w-48" aria-label="Method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All methods</SelectItem>
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
                    placeholder="Any customer"
                    className="h-9 w-52"
                  />
                </Filter>
              </>
            ) : null}
          </div>
          {!report ? (
            <QueryFallback query={data} className="h-64" label="Loading report" />
          ) : key === "inventory" && !can(SENSITIVE.productCost) ? (
            <p className="text-muted-foreground">Inventory value is at cost, which your role does not include.</p>
          ) : (
            <ScrollRegion label={`${spec.label} table`} className="border-hairline rounded-md border">
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
                        No figures for these filters. Choose a wider date range or all warehouses.
                      </td>
                    </tr>
                  ) : null}
                  {report.rows.map((row, i) => (
                    <tr key={i} className="border-hairline border-t">
                      {report!.columns.map((c) => (
                        <td key={c.id} className={cn("h-9 px-3 whitespace-nowrap", c.kind && "text-right")}>
                          {c.kind ? <Num kind={c.kind} value={row[c.id] ?? "0"} /> : row[c.id]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {report.totals ? (
                  <tfoot>
                    <tr className="border-hairline border-t-2 font-semibold">
                      {report.columns.map((c) => (
                        <td key={c.id} className={cn("h-10 px-3 whitespace-nowrap", c.kind && "text-right")}>
                          {c.kind && report!.totals![c.id] !== undefined ? (
                            <Num kind={c.kind} value={report!.totals![c.id]!} />
                          ) : (
                            report!.totals![c.id]
                          )}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </ScrollRegion>
          )}
          <p className="text-muted-foreground text-xs">{filters} Figures are computed from documents.</p>
        </Panel>
      </div>
    </>
  );
}
