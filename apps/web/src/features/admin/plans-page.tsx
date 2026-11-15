"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Archive, ArchiveRestore, CircleCheck, Eye, Pencil, Plus } from "lucide-react";
import {
  mayManageBilling,
  moduleInfo,
  PRODUCT_LABELS,
  visibleModuleKeys,
  type PlatformAdminRole,
  type PlatformPlan,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import { PageHeader } from "@workspace/ui/components/page-header";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { QueryFallback } from "@/components/query-fallback";
import { useApiQuery } from "@/lib/api/use-api";
import { PlanActiveDialog } from "./plan-active-dialog";
import { PlanDialog, type PlanDialogTarget } from "./plan-dialog";
import { usePlatformRole } from "./platform-role";

/** Active or retired, as an icon and a word. */
const PLAN_STATUS = {
  active: { tone: "success", icon: CircleCheck, label: "Active" },
  retired: { tone: "neutral", icon: Archive, label: "Retired" },
} as const;

/** The plan's modules by label; a module hidden in this build (rule 18) says so. */
function moduleText(plan: PlatformPlan, visible: ReadonlySet<string>): string {
  return plan.modules
    .map((module) => (visible.has(module) ? moduleInfo(module).label : `${moduleInfo(module).label} (hidden)`))
    .join(", ");
}

/** A limit, or "No limit" for a plan with no limits row. */
function LimitCell({ value, delta }: { value: number | null; delta: number }) {
  return value === null ? (
    <span className="text-muted-foreground">No limit</span>
  ) : (
    <Num kind="count" value={value} delta={delta} />
  );
}

interface PlanActions {
  onEdit: (plan: PlatformPlan) => void;
  onActive: (plan: PlatformPlan) => void;
}

/** The plan table's columns; the row actions only for a role that may change plans. */
function planColumns(writer: boolean, actions: PlanActions): ColumnSpec<PlatformPlan>[] {
  const visible = new Set<string>(visibleModuleKeys());
  const columns: ColumnSpec<PlatformPlan>[] = [
    {
      id: "plan",
      header: "Plan",
      value: (p) => `${p.name} ${p.key}`,
      cell: (p) => (
        <span className="flex flex-col">
          <span className="font-medium">{p.name}</span>
          <span className="text-muted-foreground text-xs">{p.key}</span>
        </span>
      ),
    },
    { id: "product", header: "Product", value: (p) => PRODUCT_LABELS[p.product] },
    {
      id: "modules",
      header: "Modules",
      value: (p) => moduleText(p, visible),
      className: "min-w-56 max-w-sm whitespace-normal",
    },
    {
      id: "users",
      header: "Users",
      kind: "count",
      value: (p) => p.maxUsers,
      cell: (p, { delta }) => <LimitCell value={p.maxUsers} delta={delta} />,
    },
    {
      id: "branches",
      header: "Branches",
      kind: "count",
      value: (p) => p.maxBranches,
      cell: (p, { delta }) => <LimitCell value={p.maxBranches} delta={delta} />,
    },
    { id: "monthly", header: "Monthly", kind: "money", value: (p) => p.monthlyPrice },
    { id: "yearly", header: "Yearly", kind: "money", value: (p) => p.yearlyPrice },
    {
      id: "companies",
      header: "Companies",
      kind: "count",
      value: (p) => p.companies,
      cell: (p, { delta }) => (
        <span className="flex flex-col items-end">
          <Num kind="count" value={p.companies} delta={delta} />
          {p.companies > 0 ? <span className="text-muted-foreground text-xs">In use</span> : null}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      value: (p) => (p.active ? PLAN_STATUS.active.label : PLAN_STATUS.retired.label),
      cell: (p) => <StatusPill {...(p.active ? PLAN_STATUS.active : PLAN_STATUS.retired)} />,
    },
  ];
  if (!writer) return columns;
  return [
    ...columns,
    {
      id: "actions",
      header: "Actions",
      visualOnly: true,
      value: () => null,
      cell: (p) => (
        <span className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => actions.onEdit(p)} aria-label={`Edit plan ${p.name}`}>
            <Pencil aria-hidden="true" />
            Edit
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => actions.onActive(p)}
            aria-label={`${p.active ? "Retire" : "Restore"} plan ${p.name}`}
          >
            {p.active ? <Archive aria-hidden="true" /> : <ArchiveRestore aria-hidden="true" />}
            {p.active ? "Retire" : "Restore"}
          </Button>
        </span>
      ),
    },
  ];
}

interface PlansViewProps extends PlanActions {
  role: PlatformAdminRole;
  /** The plans, or null while they load or failed to (the fallback then takes the table's place). */
  plans: PlatformPlan[] | null;
  fallback?: ReactNode;
  onNew: () => void;
}

/**
 * Platform admin → Plans (docs/specs/platform-admin.md, part 2, "Screens"): every plan with its
 * product, modules, limits, prices, companies and whether it is retired. Prices are data: nothing
 * is charged from here. The owner role gets New plan and each row's Edit and Retire or Restore; the
 * support role reads a note instead and gets no action. The API's guard still decides.
 */
export function PlansView({ role, plans, fallback, onNew, onEdit, onActive }: PlansViewProps) {
  const writer = mayManageBilling(role);
  const columns = useMemo(() => planColumns(writer, { onEdit, onActive }), [writer, onEdit, onActive]);
  return (
    <>
      <PageHeader
        title="Plans"
        description="What each plan includes. Prices are data: nothing is charged from here."
        actions={
          writer ? (
            <Button onClick={onNew}>
              <Plus />
              New plan
            </Button>
          ) : undefined
        }
      />
      {writer ? null : (
        <p
          role="note"
          className="border-hairline bg-raised text-muted-foreground flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
        >
          <Eye aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Read only: only the platform owner role can change plans.
        </p>
      )}
      {plans === null ? (
        fallback
      ) : (
        <DataTable
          id="platform-plans"
          rows={plans}
          columns={columns}
          getRowId={(p) => p.id}
          searchPlaceholder="Search plans"
          empty={{ message: "No plans yet." }}
        />
      )}
    </>
  );
}

/**
 * The Plans page: reads the plans, then opens the plan dialog or the retire and restore dialog. After
 * a write the list is read again in place, because a write over HTTP doesn't tell screens itself.
 */
export function PlansPage() {
  const role = usePlatformRole();
  const [reads, setReads] = useState(0);
  const query = useApiQuery((client) => client.listPlatformPlans(), [reads]);
  const [editing, setEditing] = useState<PlanDialogTarget | null>(null);
  const [activeChange, setActiveChange] = useState<PlatformPlan | null>(null);
  const reread = () => setReads((n) => n + 1);
  const onEdit = useCallback((plan: PlatformPlan) => setEditing({ kind: "edit", plan }), []);
  const onActive = useCallback((plan: PlatformPlan) => setActiveChange(plan), []);
  return (
    <>
      <PlansView
        role={role}
        plans={query.status === "ready" ? query.data : null}
        fallback={<QueryFallback query={query} className="h-64" label="Loading plans" />}
        onNew={() => setEditing({ kind: "new" })}
        onEdit={onEdit}
        onActive={onActive}
      />
      {editing ? <PlanDialog target={editing} onClose={() => setEditing(null)} onSaved={reread} /> : null}
      {activeChange ? (
        <PlanActiveDialog plan={activeChange} onClose={() => setActiveChange(null)} onChanged={reread} />
      ) : null}
    </>
  );
}
