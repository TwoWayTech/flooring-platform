"use client";

import { useState } from "react";
import { CircleCheck, CircleDashed, Pencil, Plus, Send, TriangleAlert, Wallet } from "lucide-react";
import { toast } from "sonner";
import { last12Months, type CommissionAssignment, type CommissionPlan } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Panel } from "@workspace/ui/components/panel";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { Field } from "@/components/field";
import { NoAccess } from "@/components/no-access";
import { QueryFallback } from "@/components/query-fallback";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import type { CommissionPerson, CommissionStatementRow } from "@/lib/api/contract";
import { useApiQuery } from "@/lib/api/use-api";
import { useFormatDate } from "@/lib/use-format-date";
import { HrTabs } from "../hr-tabs";
import { Pick } from "../pick";
import { PlanFormDialog } from "./plan-form-dialog";
import { monthName } from "./month-name";
import { PlanTerms } from "./plan-terms";
import { statementFigureColumns } from "./statement-columns";
import { StatementSheet } from "./statement-sheet";

const STATUS = {
  draft: { tone: "neutral", icon: CircleDashed, label: "Open" },
  approved: { tone: "brand", icon: CircleCheck, label: "Approved" },
  paid: { tone: "success", icon: Wallet, label: "Paid" },
} as const;

function AssignDialog({
  users,
  plans,
  onClose,
}: {
  users: readonly CommissionPerson[];
  plans: readonly CommissionPlan[];
  onClose: () => void;
}) {
  const [userId, setUserId] = useState(users[0]?.id ?? "");
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [effectiveFrom, setFrom] = useState(api.today());
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function save() {
    try {
      await api.assignPlan({ userId, planId, effectiveFrom, monthlyTargetOverride: target });
      toast.success("Plan assigned; it needs signing");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not assign this plan.");
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-surface sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign a plan</DialogTitle>
          <DialogDescription>The person signs the plan from their portal.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field id="asg-user" label="Person">
            <Pick
              id="asg-user"
              value={userId}
              onChange={setUserId}
              options={users.map((u) => [u.id, u.name] as const)}
            />
          </Field>
          <Field id="asg-plan" label="Plan">
            <Pick
              id="asg-plan"
              value={planId}
              onChange={setPlanId}
              options={plans.map((p) => [p.id, p.name] as const)}
            />
          </Field>
          <Field id="asg-from" label="From">
            <Input id="asg-from" type="date" value={effectiveFrom} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field id="asg-target" label="Own monthly target $ (optional)">
            <Input
              id="asg-target"
              inputMode="decimal"
              value={target}
              onChange={(e) => setTarget(e.target.value.replace(/[^\d.]/g, ""))}
            />
          </Field>
        </div>
        {error ? (
          <p role="alert" className="text-danger-ink text-sm">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()}>Assign</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Commissions (spec C1, ADR 0025): monthly statements approved by HR or the Owner, plans with tiers,
 * override, draw and clawback, and who is on which plan with their signed receipt.
 */
export function CommissionsPage() {
  const can = useCan();
  const { product } = useWorkspace();
  const formatDate = useFormatDate();
  const months = last12Months(api.today());
  const [month, setMonth] = useState(months.at(-2) ?? "");
  const [openUser, setOpenUser] = useState<string | null>(null);
  const [planEdit, setPlanEdit] = useState<CommissionPlan | "new" | null>(null);
  const [assigning, setAssigning] = useState(false);
  // One source for the page, so HR needs no access to Sales to name people and invoices (ADR 0048).
  const data = useApiQuery((client) => client.commissionData(), []);
  if (!can("hr.commission.view")) return <NoAccess />;
  const canManage = can("hr.commission.manage");

  const rows = (data.data?.statements ?? []).filter(
    (s) => s.month === month && (s.lines.length > 0 || s.status !== "draft"),
  );
  const statementColumns: ColumnSpec<CommissionStatementRow>[] = [
    { id: "name", header: "Person", value: (r) => r.name, cell: (r) => <span className="font-medium">{r.name}</span> },
    { id: "plan", header: "Plan", value: (r) => r.planName ?? "None" },
    ...statementFigureColumns(rows).map((c): ColumnSpec<CommissionStatementRow> => ({
      ...c,
      kind: "money",
      total: true,
    })),
    {
      id: "status",
      header: "Status",
      value: (r) => STATUS[r.status].label,
      cell: (r) =>
        r.needsReview ? (
          <StatusPill tone="warning" icon={TriangleAlert} label="Needs review" />
        ) : r.status === "draft" && r.monthEnded && r.lines.length > 0 ? (
          <StatusPill tone="warning" icon={Send} label="To approve" />
        ) : (
          <StatusPill {...STATUS[r.status]} />
        ),
    },
  ];
  const nameOf = (userId: string) => data.data?.people.find((u) => u.id === userId)?.name ?? "Unknown";
  const planOf = (planId: string) => data.data?.plans.find((p) => p.id === planId);
  const current = (data.data?.assignments ?? []).filter((a) => !a.effectiveTo);
  const anyUnsigned = current.some((a) => !a.acknowledgement);
  const assignmentColumns: ColumnSpec<CommissionAssignment>[] = [
    {
      id: "name",
      header: "Person",
      value: (a) => nameOf(a.userId),
      cell: (a) => <span className="font-medium">{nameOf(a.userId)}</span>,
    },
    { id: "plan", header: "Plan", value: (a) => planOf(a.planId)?.name ?? "" },
    { id: "from", header: "From", value: (a) => a.effectiveFrom, cell: (a) => formatDate(a.effectiveFrom) },
    {
      id: "signed",
      header: "Signed",
      value: (a) => (a.acknowledgement ? "Signed" : "Not signed"),
      cell: (a) =>
        a.acknowledgement ? (
          <StatusPill
            tone="success"
            icon={CircleCheck}
            label={`Signed ${formatDate(a.acknowledgement.signedAt.slice(0, 10))}`}
          />
        ) : (
          <StatusPill tone="warning" icon={TriangleAlert} label="Not signed" />
        ),
    },
  ];
  const open = rows.find((r) => r.userId === openUser);
  const canBeAssigned = (data.data?.people ?? []).filter((p) => p.active);

  return (
    <>
      <PageHeader title={product.key === "hr" ? "Commissions" : "HR"} />
      <HrTabs />
      {data.status !== "ready" ? (
        <QueryFallback query={data} className="h-96" label="Loading commissions" />
      ) : (
        <Tabs defaultValue="statements" className="gap-6">
          <TabsList aria-label="Commission view">
            <TabsTrigger value="statements">Statements</TabsTrigger>
            <TabsTrigger value="plans">Plans</TabsTrigger>
            <TabsTrigger value="people">People on plans</TabsTrigger>
          </TabsList>
          <TabsContent value="statements">
            <DataTable
              id="hr-commission-statements"
              rows={rows}
              columns={statementColumns}
              getRowId={(r) => r.userId}
              onRowClick={(r) => setOpenUser(r.userId)}
              rowLabel={(r) => `Open ${r.name}'s statement`}
              searchPlaceholder="Search people"
              csvName={`commission-${month}`}
              initialSort={{ id: "name", desc: false }}
              toolbar={
                <div className="w-52">
                  <Pick
                    label="Month"
                    value={month}
                    onChange={setMonth}
                    options={[...months].reverse().map((m) => [m, monthName(m)] as const)}
                  />
                </div>
              }
              empty={{ message: "No commission this month." }}
            />
          </TabsContent>
          <TabsContent value="plans" className="flex flex-col gap-4">
            {canManage ? (
              <div>
                <Button onClick={() => setPlanEdit("new")}>
                  <Plus />
                  New plan
                </Button>
              </div>
            ) : null}
            {data.data.plans
              .filter((p) => p.status === "active")
              .map((plan) => (
                <Panel
                  key={plan.id}
                  title={`${plan.name}, version ${plan.version}`}
                  actions={
                    canManage ? (
                      <Button size="sm" variant="ghost" onClick={() => setPlanEdit(plan)}>
                        <Pencil />
                        Edit
                      </Button>
                    ) : null
                  }
                >
                  <PlanTerms plan={plan} />
                </Panel>
              ))}
          </TabsContent>
          <TabsContent value="people" className="flex flex-col gap-4">
            {canManage ? (
              <div>
                <Button onClick={() => setAssigning(true)}>
                  <Plus />
                  Assign a plan
                </Button>
              </div>
            ) : null}
            {anyUnsigned ? (
              <p className="text-muted-foreground text-sm">
                To collect an e-signature, show commission to this person first; otherwise sign on paper.
              </p>
            ) : null}
            <DataTable
              id="hr-commission-people"
              rows={current}
              columns={assignmentColumns}
              getRowId={(a) => a.id}
              searchPlaceholder="Search people"
              csvName="commission-plans-assigned"
              initialSort={{ id: "name", desc: false }}
              empty={{ message: "Nobody is on a plan yet." }}
            />
          </TabsContent>
        </Tabs>
      )}
      {open && data.data ? (
        <StatementSheet row={open} invoices={data.data.invoices} onClose={() => setOpenUser(null)} />
      ) : null}
      {planEdit ? (
        <PlanFormDialog plan={planEdit === "new" ? null : planEdit} onClose={() => setPlanEdit(null)} />
      ) : null}
      {assigning && data.data ? (
        <AssignDialog
          users={canBeAssigned}
          plans={data.data.plans.filter((p) => p.status === "active")}
          onClose={() => setAssigning(false)}
        />
      ) : null}
    </>
  );
}
