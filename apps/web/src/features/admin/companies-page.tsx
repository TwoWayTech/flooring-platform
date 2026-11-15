"use client";

import { useRouter } from "next/navigation";
import { PRODUCT_LABELS, visibleModules, type PlatformCompanySummary } from "@workspace/shared";
import { Num } from "@workspace/ui/components/num";
import { PageHeader } from "@workspace/ui/components/page-header";
import { QueryFallback } from "@/components/query-fallback";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { useApiQuery } from "@/lib/api/use-api";
import { CompanyPhasePill, CompanyStatusPill, PHASE, STATUS } from "./company-status";
import { DATABASE_LABELS, databaseErrorText, databaseText, MAINTENANCE_LABELS } from "./database-labels";

/** A company's maintenance switch in words: "Off", or why it is on. */
function maintenanceText(company: PlatformCompanySummary): string {
  const { on, reason } = company.maintenance;
  if (!on) return "Off";
  return reason ? MAINTENANCE_LABELS[reason] : "On";
}

/** The company's modules a person can see, by label; Platform is always on, so it is left out (rule 18). */
function moduleLabels(company: PlatformCompanySummary): string {
  return visibleModules()
    .filter((m) => m.key !== "platform" && company.modules.includes(m.key))
    .map((m) => m.label)
    .join(", ");
}

const COLUMNS: ColumnSpec<PlatformCompanySummary>[] = [
  { id: "name", header: "Company", value: (c) => c.name, cell: (c) => <span className="font-medium">{c.name}</span> },
  { id: "city", header: "Location", value: (c) => `${c.city}, ${c.state}` },
  {
    id: "status",
    header: "Status",
    value: (c) => STATUS[c.status].label,
    cell: (c) => <CompanyStatusPill status={c.status} />,
  },
  {
    id: "phase",
    header: "Phase",
    value: (c) => PHASE[c.phase].label,
    cell: (c) => <CompanyPhasePill phase={c.phase} />,
  },
  { id: "plan", header: "Plan", value: (c) => c.plan },
  { id: "products", header: "Products", value: (c) => c.products.map((p) => PRODUCT_LABELS[p]).join(", ") },
  { id: "modules", header: "Modules", value: moduleLabels },
  {
    id: "users",
    header: "User limit",
    kind: "count",
    value: (c) => c.userLimit,
    cell: (c, { delta }) =>
      c.userLimit === null ? (
        <span className="text-muted-foreground">No limit</span>
      ) : (
        <Num kind="count" value={c.userLimit} delta={delta} />
      ),
  },
  // People with a sign-in to the company, not seats in use: seats need the company's own database.
  { id: "members", header: "Members", kind: "count", value: (c) => c.members },
  // The state and, after a failed update, its error code only (part 3, "Database errors and
  // maintenance"): the text never reaches the console, so neither the cell nor the CSV can show it.
  {
    id: "database",
    header: "Database",
    value: (c) => databaseText(c.database),
    cell: (c) => {
      if (!c.database.status) return <span className="text-muted-foreground">No database</span>;
      const error = databaseErrorText(c.database);
      return (
        <span className="flex flex-col">
          <span>{DATABASE_LABELS[c.database.status]}</span>
          {error ? <span className="text-danger-ink text-xs tabular-nums">{error}</span> : null}
        </span>
      );
    },
  },
  {
    id: "maintenance",
    header: "Maintenance",
    value: maintenanceText,
    cell: (c) =>
      c.maintenance.on ? (
        <span className="text-warning-ink font-medium">{maintenanceText(c)}</span>
      ) : (
        <span className="text-muted-foreground">Off</span>
      ),
  },
];

/** Platform admin: every company with its status, phase, plan, products and modules (docs/specs/platform-admin.md). */
export function CompaniesPage() {
  const router = useRouter();
  const data = useApiQuery((client) => client.listPlatformCompanies(), []);
  return (
    <>
      <PageHeader
        title="Companies"
        description="Plans, products, modules and access for every company on the platform."
      />
      {data.status !== "ready" ? (
        <QueryFallback query={data} className="h-64" label="Loading companies" />
      ) : (
        <DataTable
          id="admin-companies"
          rows={data.data}
          columns={COLUMNS}
          getRowId={(c) => c.id}
          onRowClick={(c) => router.push(`/admin/companies/${encodeURIComponent(c.id)}`)}
          rowLabel={(c) => `Open access for ${c.name}`}
          searchPlaceholder="Search companies"
          csvName="companies"
          empty={{ message: "No companies yet." }}
        />
      )}
    </>
  );
}
