"use client";

import { useState } from "react";
import type { AuditCategory, AuditEntry } from "@workspace/shared";
import { Label } from "@workspace/ui/components/label";
import { useNumberSettings } from "@workspace/ui/components/number-settings";
import { Switch } from "@workspace/ui/components/switch";
import { QueryFallback } from "@/components/query-fallback";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { NoAccess } from "@/components/no-access";
import { useCan } from "@/components/workspace/workspace-context";
import { useApiQuery } from "@/lib/api/use-api";
import { useFormatDate } from "@/lib/use-format-date";
import { AuditChangeList, auditChangesText } from "./audit-change-list";

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
 * Settings: Audit log (blueprint "Audit log": who, what, when, before and after). Every change is
 * listed, newest first; the log is read-only. Before and after read as one line per changed field
 * ("Location: Denver Central → Boulder Showroom"), with Show raw for the stored values
 * (click-through #58). The raw values are also columns, hidden at first, that the Columns menu
 * shows and the CSV then exports.
 */
export function AuditLogPage() {
  const can = useCan();
  const formatDate = useFormatDate();
  const numbers = useNumberSettings();
  const [raw, setRaw] = useState(false);
  const data = useApiQuery((client) => client.list("audit"), []);
  if (!can("settings.audit.view")) return <NoAccess />;
  if (data.status !== "ready") return <QueryFallback query={data} className="h-96" label="Loading audit log" />;

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
      id: "change",
      header: "Change",
      value: (e) => auditChangesText(e, numbers),
      cell: (e) => <AuditChangeList entry={e} raw={raw} />,
      filter: "text",
      className: "min-w-64 max-w-md align-top text-sm",
    },
    { id: "before", header: "Before (raw)", value: (e) => e.before, hidden: true },
    { id: "after", header: "After (raw)", value: (e) => e.after, hidden: true },
  ];

  return (
    <DataTable
      id="settings-audit"
      rows={data.data}
      columns={columns}
      getRowId={(e) => e.id}
      searchPlaceholder="Search the audit log"
      csvName="audit-log"
      initialSort={{ id: "at", desc: true }}
      toolbar={
        <div className="flex items-center gap-2">
          <Switch id="audit-raw" checked={raw} onCheckedChange={setRaw} />
          <Label htmlFor="audit-raw" className="text-sm">
            Show raw
          </Label>
        </div>
      }
      empty={{ message: "No changes recorded yet." }}
    />
  );
}
