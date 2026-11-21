"use client";

import type { AuditCategory, AuditEntry } from "@workspace/shared";
import { QueryFallback } from "@/components/query-fallback";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { NoAccess } from "@/components/no-access";
import { useCan } from "@/components/workspace/workspace-context";
import { useApiQuery } from "@/lib/api/use-api";
import { useFormatDate } from "@/lib/use-format-date";

const CATEGORIES: Record<AuditCategory, string> = {
  role: "Roles",
  user: "Users",
  ceiling: "Plan and access",
  settings: "Settings",
  data: "Records",
  security: "Security",
  payment: "Payments",
};

/**
 * Settings: Audit log (blueprint "Audit log": who, what, when, before and after). Every change
 * made in the demo is listed, newest first; the log is read-only.
 */
export function AuditLogPage() {
  const can = useCan();
  const formatDate = useFormatDate();
  const data = useApiQuery((client) => client.list("audit"), []);
  if (!can("settings.audit.view")) return <NoAccess />;
  if (data.status !== "ready") return <QueryFallback query={data} className="h-96" label="Loading audit log" />;
  const columns = auditLogColumns(formatDate);

  return (
    <DataTable
      id="settings-audit"
      rows={data.data}
      columns={columns}
      getRowId={(e) => e.id}
      searchPlaceholder="Search the audit log"
      csvName="audit-log"
      initialSort={{ id: "at", desc: true }}
      empty={{ message: "No changes recorded yet." }}
    />
  );
}

/**
 * The audit log's columns. "When" is the entry's moment on the company's clock in 12-hour time with
 * the zone named, "Nov 21, 2026, 7:56 AM MST" (ADR 0064, click-through #57); the CSV export writes it
 * as ISO 8601 with the company's offset.
 */
export function auditLogColumns(formatDate: (iso: string, withTime?: boolean) => string): ColumnSpec<AuditEntry>[] {
  return [
    { id: "at", header: "When", value: (e) => e.at, cell: (e) => formatDate(e.at, true) },
    {
      id: "who",
      header: "Who",
      value: (e) => e.actorName,
      cell: (e) => (
        <span className="flex flex-col">
          <span>{e.actorName}</span>
          <span className="text-muted-foreground text-xs">{e.actorRole}</span>
        </span>
      ),
    },
    { id: "category", header: "Area", value: (e) => CATEGORIES[e.category] },
    {
      id: "action",
      header: "What",
      value: (e) => e.action,
      cell: (e) => <span className="font-medium">{e.action}</span>,
    },
    { id: "target", header: "On", value: (e) => e.target },
    {
      id: "before",
      header: "Before",
      value: (e) => e.before,
      cell: (e) => <span className="text-muted-foreground">{e.before ?? "None"}</span>,
      className: "max-w-64 truncate",
    },
    {
      id: "after",
      header: "After",
      value: (e) => e.after,
      cell: (e) => e.after ?? <span className="text-muted-foreground">None</span>,
      className: "max-w-64 truncate",
    },
  ];
}
