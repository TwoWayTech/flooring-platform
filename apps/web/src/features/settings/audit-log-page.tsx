"use client";

import { useState } from "react";
import type { AuditCategory, AuditEntry } from "@workspace/shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
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
};

/**
 * Settings: Audit log (blueprint "Audit log": who, what, when, before and after). Every change
 * made in the demo is listed, newest first; the log is read-only.
 */
export function AuditLogPage() {
  const can = useCan();
  const formatDate = useFormatDate();
  const [category, setCategory] = useState<AuditCategory | "all">("all");
  const data = useApiQuery((client) => client.list("audit"), []);
  if (!can("settings.audit.view")) return <NoAccess />;
  if (data.status !== "ready") return <QueryFallback query={data} className="h-96" label="Loading audit log" />;
  const rows = data.data.filter((e) => category === "all" || e.category === category);

  const columns: ColumnSpec<AuditEntry>[] = [
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

  return (
    <DataTable
      id="settings-audit"
      rows={rows}
      columns={columns}
      getRowId={(e) => e.id}
      searchPlaceholder="Search the audit log"
      csvName="audit-log"
      initialSort={{ id: "at", desc: true }}
      empty={{ message: "No changes recorded yet." }}
      toolbar={
        <Select value={category} onValueChange={(v) => setCategory(v as AuditCategory | "all")}>
          <SelectTrigger className="bg-surface h-9 w-44" aria-label="Area">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All areas</SelectItem>
            {(Object.keys(CATEGORIES) as AuditCategory[]).map((c) => (
              <SelectItem key={c} value={c}>
                {CATEGORIES[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  );
}
