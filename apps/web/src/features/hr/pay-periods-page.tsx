"use client";

import { useState } from "react";
import {
  CircleCheck,
  CircleDashed,
  Download,
  Eye,
  FileCheck2,
  RotateCcw,
  TriangleAlert,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import {
  GROSS_PAY_LABEL,
  paySummaryTable,
  payWorkweekTable,
  type ContractorPayment,
  type PayPeriod,
  bonusPay,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Panel } from "@workspace/ui/components/panel";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { NoAccess } from "@/components/no-access";
import { NotShown } from "@/components/not-shown";
import { QueryFallback } from "@/components/query-fallback";
import { ReasonDialog } from "@/components/reason-dialog";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { writeTableFile } from "@/features/import/import-files";
import { api } from "@/lib/api";
import type { PayPeriodReview, PayReviewRow } from "@/lib/api/contract";
import { useApiQuery } from "@/lib/api/use-api";
import { saveBlob } from "@/lib/save-blob";
import { useFormatDate } from "@/lib/use-format-date";
import { CaliforniaPayNote } from "./california-pay-note";
import { HrTabs } from "./hr-tabs";
import { Pick } from "./pick";

const STATUS = {
  open: { tone: "neutral", icon: CircleDashed, label: "Open" },
  in_review: { tone: "warning", icon: Eye, label: "In review" },
  approved: { tone: "brand", icon: CircleCheck, label: "Approved" },
  exported: { tone: "success", icon: FileCheck2, label: "Exported" },
} as const;

async function exportCsv(table: string[][], name: string) {
  saveBlob(await writeTableFile(table, "csv", "Pay period"), name);
}

/**
 * One pay period's review (spec C1): blockers, actions and the lines table. A line's salary the
 * viewer may not see arrives stripped and shows as "Not shown" (CLAUDE.md rule 5; click-through #26).
 */
export function ReviewBody({ review, period }: { review: PayPeriodReview; period: PayPeriod }) {
  const can = useCan();
  const formatDate = useFormatDate();
  const [excluding, setExcluding] = useState<PayReviewRow | null>(null);
  const canApprove = can("hr.payroll.approve");
  const locked = period.status === "approved" || period.status === "exported";
  const included = review.rows.filter((r) => !r.excludedReason);
  // Without hr.employee.view_sensitive the API strips each line's salary (click-through #26).
  const salaryShown = review.rows.every((r) => r.line.salaryAmount !== undefined);

  async function run(action: () => Promise<unknown>, done: string) {
    try {
      await action();
      toast.success(done);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work.");
    }
  }

  async function exportPeriod() {
    await run(async () => {
      await api.exportPayPeriod(period.id);
      await exportCsv(paySummaryTable(period, included), `pay-period-${period.start}.csv`);
    }, "Pay period exported");
  }

  const columns: ColumnSpec<PayReviewRow>[] = [
    {
      id: "name",
      header: "Employee",
      value: (r) => r.employee.name,
      cell: (r) => (
        <span className="flex flex-col">
          <span className="font-medium">{r.employee.name}</span>
          <span className="text-muted-foreground text-xs">
            {r.excludedReason ? `Left out: ${r.excludedReason}` : r.employee.title}
          </span>
        </span>
      ),
    },
    { id: "hours", header: "Hours", kind: "quantity", value: (r) => r.line.hoursWorked },
    { id: "ot", header: "Overtime", kind: "quantity", value: (r) => r.line.overtimeHours, hidden: true },
    { id: "straight", header: "Hours pay", kind: "money", value: (r) => r.line.straightTimePay, total: true },
    {
      id: "salary",
      header: "Salary",
      kind: "money",
      value: (r) => r.line.salaryAmount ?? null,
      // No partial or zero total when a salary is not shown (CLAUDE.md rule 5).
      total: salaryShown,
      cell: (r, { delta }) =>
        r.line.salaryAmount === undefined ? (
          <NotShown />
        ) : (
          <Num kind="money" value={r.line.salaryAmount} delta={delta} />
        ),
    },
    { id: "premium", header: "Overtime pay", kind: "money", value: (r) => r.line.overtimePremium, total: true },
    { id: "leave", header: "Paid leave", kind: "money", value: (r) => r.line.paidLeavePay, total: true },
    { id: "commission", header: "Commission", kind: "money", value: (r) => r.line.commissionPay, total: true },
    { id: "trueup", header: "Overtime true-up", kind: "money", value: (r) => r.line.overtimeTrueUp, total: true },
    {
      id: "bonus",
      header: "Bonus",
      kind: "money",
      value: (r) => bonusPay(r.line),
      total: true,
    },
    { id: "deduct", header: "Unpaid leave", kind: "money", value: (r) => r.line.salaryDeduction, hidden: true },
    {
      id: "gross",
      header: "Gross pay",
      kind: "money",
      value: (r) => r.line.grossPay,
      total: true,
      cell: (r, { delta }) => (
        <span className="font-medium">
          <Num kind="money" value={r.line.grossPay} delta={delta} />
        </span>
      ),
    },
    ...(canApprove && !locked
      ? [
          {
            id: "exclude",
            header: "Run",
            value: () => "",
            visualOnly: true,
            cell: (r: PayReviewRow) =>
              r.excludedReason ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void run(() => api.setPayExclusion(period.id, r.employee.id, null), "Back in this run")
                  }
                >
                  <UserPlus />
                  Include
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setExcluding(r)}>
                  <UserMinus />
                  Leave out
                </Button>
              ),
          } satisfies ColumnSpec<PayReviewRow>,
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm" data-testid="gross-pay-label">
        {GROSS_PAY_LABEL}
      </p>
      {review.warnings.map((note) => (
        <CaliforniaPayNote key={note} note={note} />
      ))}
      {review.blockers.length > 0 ? (
        <Panel title={`${review.blockers.length} timesheets still need approval`}>
          <ul className="flex flex-col gap-1 text-sm">
            {review.blockers.slice(0, 10).map((b) => (
              <li key={`${b.employeeId}-${b.weekStart}`} className="flex flex-wrap items-center gap-2">
                <TriangleAlert aria-hidden="true" className="text-warning-ink size-4" />
                {b.employeeName}, week of {formatDate(b.weekStart)}:{" "}
                {b.status === "missing" ? "no timesheet" : b.status}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {review.strandedCommission?.length ? (
        <Panel title="Approved commission no pay run can pay">
          <ul className="flex flex-col gap-1 text-sm">
            {review.strandedCommission.map((s) => (
              <li key={s.statementId} className="flex flex-wrap items-center gap-2">
                <TriangleAlert aria-hidden="true" className="text-warning-ink size-4" />
                {s.name}, {s.month}: {s.reason}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canApprove && !locked ? (
          <Button onClick={() => void run(() => api.approvePayPeriod(period.id), "Pay period approved")}>
            <CircleCheck />
            Approve pay period
          </Button>
        ) : null}
        {canApprove && period.status === "approved" ? (
          <Button variant="outline" onClick={() => void run(() => api.reopenPayPeriod(period.id), "Back in review")}>
            <RotateCcw />
            Reopen
          </Button>
        ) : null}
        {can("hr.payroll.export") && period.status === "approved" ? (
          <Button onClick={() => void exportPeriod()}>
            <Download />
            Export for payroll
          </Button>
        ) : null}
        {locked ? (
          <>
            <Button
              variant="outline"
              onClick={() => void exportCsv(paySummaryTable(period, included), `pay-period-${period.start}.csv`)}
            >
              <Download />
              Summary CSV
            </Button>
            <Button
              variant="outline"
              onClick={() => void exportCsv(payWorkweekTable(included), `pay-period-${period.start}-workweeks.csv`)}
            >
              <Download />
              Workweek CSV
            </Button>
          </>
        ) : null}
      </div>
      <DataTable
        id="hr-pay-period"
        rows={review.rows}
        columns={columns}
        getRowId={(r) => r.employee.id}
        searchPlaceholder="Search people"
        csvName={`gross-pay-${period.start}`}
        initialSort={{ id: "name", desc: false }}
        empty={{ message: "Nobody is paid in this period." }}
      />
      {excluding ? (
        <ReasonDialog
          title={`Leave ${excluding.employee.name} out of this run`}
          description="Their hours stay as they are and can be paid in a later run."
          confirmLabel="Leave out"
          onConfirm={(reason) => api.setPayExclusion(period.id, excluding.employee.id, reason)}
          onClose={() => setExcluding(null)}
        />
      ) : null}
    </div>
  );
}

function Contractors({ payments, nameOf }: { payments: readonly ContractorPayment[]; nameOf: (id: string) => string }) {
  const formatDate = useFormatDate();
  const columns: ColumnSpec<ContractorPayment>[] = [
    {
      id: "name",
      header: "Contractor",
      value: (p) => nameOf(p.employeeId),
      cell: (p) => <span className="font-medium">{nameOf(p.employeeId)}</span>,
    },
    { id: "date", header: "Date", value: (p) => p.date, cell: (p) => formatDate(p.date) },
    { id: "what", header: "For", value: (p) => p.description },
    { id: "status", header: "Status", value: (p) => (p.status === "paid" ? "Paid" : "Approved") },
    { id: "amount", header: "Amount", kind: "money", value: (p) => p.amount, total: true },
  ];
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        Contractors are paid by job. They have no hours, overtime or paid leave, and they are not in the W-2 file.
      </p>
      <DataTable
        id="hr-contractor-payments"
        rows={[...payments]}
        columns={columns}
        getRowId={(p) => p.id}
        searchPlaceholder="Search contractor payments"
        csvName="contractor-payments"
        initialSort={{ id: "date", desc: true }}
        empty={{ message: "No contractor payments yet." }}
      />
    </div>
  );
}

/** Pay periods (spec C1, ADR 0024): pick a period, review each person's gross pay, approve, export. */
export function PayPeriodsPage() {
  const can = useCan();
  const { product } = useWorkspace();
  const formatDate = useFormatDate();
  const [chosen, setChosen] = useState<string | null>(null);
  const periods = useApiQuery((client) => client.listPayPeriods(), []);
  const list = periods.data ?? [];
  const current = chosen ?? (list.find((p) => p.status === "in_review") ?? list[0])?.id ?? "";
  const review = useApiQuery(
    (client) => (current ? client.reviewPayPeriod(current) : Promise.resolve(null)),
    [current],
  );
  if (!can("hr.payroll.view")) return <NoAccess />;

  return (
    <>
      <PageHeader title={product.key === "hr" ? "Pay periods" : "HR"} />
      <HrTabs />
      {periods.status !== "ready" || review.status !== "ready" || !review.data ? (
        <QueryFallback
          query={periods.status !== "ready" ? periods : review}
          className="h-96"
          label="Loading pay periods"
        />
      ) : (
        <Tabs defaultValue="review" className="gap-6">
          <TabsList aria-label="Pay view">
            <TabsTrigger value="review">Gross pay</TabsTrigger>
            <TabsTrigger value="contractors">Contractor payments</TabsTrigger>
          </TabsList>
          <TabsContent value="review" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-72 max-w-full">
                <Pick
                  label="Pay period"
                  value={current}
                  onChange={setChosen}
                  options={list.map((p) => [p.id, `${formatDate(p.start)} to ${formatDate(p.end)}`] as const)}
                />
              </div>
              <StatusPill {...STATUS[review.data.period.status]} />
              <span className="text-muted-foreground text-sm">Pay date {formatDate(review.data.period.payDate)}</span>
            </div>
            <ReviewBody review={review.data} period={review.data.period} />
          </TabsContent>
          <TabsContent value="contractors">
            <Contractors
              payments={review.data.contractors}
              nameOf={(id) => review.data?.contractorNames[id] ?? "Contractor"}
            />
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}
