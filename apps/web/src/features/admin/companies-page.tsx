"use client";

import { useRouter } from "next/navigation";
import { CircleCheck, Clock, CreditCard, PauseCircle } from "lucide-react";
import { MODULES, PRODUCT_LABELS, type Company } from "@workspace/shared";
import { PageHeader } from "@workspace/ui/components/page-header";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { QueryFallback } from "@/components/query-fallback";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { useApiQuery } from "@/lib/api/use-api";

const STATUS = {
  active: { tone: "success", icon: CircleCheck, label: "Active" },
  trial: { tone: "brand", icon: Clock, label: "Trial" },
  past_due: { tone: "warning", icon: CreditCard, label: "Past due" },
  suspended: { tone: "neutral", icon: PauseCircle, label: "Suspended" },
} as const;

/** Super-admin: every company on the platform with its status, plan, product and modules (spec "Super-admin"). */
export function CompaniesPage() {
  const router = useRouter();
  const data = useApiQuery((client) => client.listCompanies(), []);
  const columns: ColumnSpec<Company>[] = [
    { id: "name", header: "Company", value: (c) => c.name, cell: (c) => <span className="font-medium">{c.name}</span> },
    { id: "city", header: "Location", value: (c) => `${c.city}, ${c.state}` },
    {
      id: "status",
      header: "Status",
      value: (c) => STATUS[c.status].label,
      cell: (c) => <StatusPill {...STATUS[c.status]} />,
    },
    { id: "plan", header: "Plan", value: (c) => c.plan },
    { id: "product", header: "Product", value: (c) => PRODUCT_LABELS[c.product] },
    {
      id: "modules",
      header: "Modules",
      value: (c) =>
        MODULES.filter((m) => m.key !== "platform" && c.modules.includes(m.key))
          .map((m) => m.label)
          .join(", "),
    },
    { id: "users", header: "User limit", kind: "count", value: (c) => c.userLimit },
  ];
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
          columns={columns}
          getRowId={(c) => c.id}
          onRowClick={(c) => router.push(`/admin/companies/${c.id}`)}
          rowLabel={(c) => `Open access for ${c.name}`}
          searchPlaceholder="Search companies"
          csvName="companies"
          empty={{ message: "No companies yet." }}
        />
      )}
    </>
  );
}
