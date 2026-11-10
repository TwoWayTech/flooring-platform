"use client";

import { useState } from "react";
import { Ban, CircleCheck, CircleDashed, Clock, FileText, Plus, Repeat, XCircle } from "lucide-react";
import { toast } from "sonner";
import { EXPENSE_CATEGORY_LABELS, expenseCost, moneyString, type Expense, type FileMeta } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet";
import { Num } from "@workspace/ui/components/num";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { QueryFallback } from "@/components/query-fallback";
import { ReasonDialog } from "@/components/reason-dialog";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { FileViewerDialog } from "@/features/invoices/payments/file-viewer-dialog";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { useFormatDate } from "@/lib/use-format-date";
import { ExpenseFormDialog } from "./expense-form-dialog";
import { RecurringExpensesSheet } from "./recurring-expenses";

const STATUS = {
  draft: { tone: "neutral", icon: CircleDashed, label: "Draft" },
  pending: { tone: "warning", icon: Clock, label: "Waiting for approval" },
  confirmed: { tone: "success", icon: CircleCheck, label: "Confirmed" },
  rejected: { tone: "danger", icon: XCircle, label: "Rejected" },
  voided: { tone: "neutral", icon: Ban, label: "Void" },
} as const;

/** Finance → Expenses (spec F1): what the company spends, per location, each with its receipt. */
export function ExpensesView() {
  const can = useCan();
  const { user } = useWorkspace();
  const formatDate = useFormatDate();
  const [editing, setEditing] = useState<Expense | "new" | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<FileMeta | null>(null);
  const [asking, setAsking] = useState<"reject" | "void" | null>(null);
  const [managing, setManaging] = useState(false);
  const data = useApiQuery(async (client) => {
    const [expenses, suppliers, locations, recurring] = await Promise.all([
      client.list("expenses"),
      client.list("suppliers"),
      client.list("locations"),
      client.list("recurringExpenses"),
    ]);
    return { expenses: expenses.filter((e) => e.category !== "payroll"), suppliers, locations, recurring };
  }, []);
  if (data.status !== "ready") return <QueryFallback query={data} className="h-96" label="Loading expenses" />;
  const { expenses, suppliers, locations, recurring } = data.data;
  const vendorOf = (e: Expense) => suppliers.find((s) => s.id === e.supplierId)?.name ?? "No vendor";
  const placeOf = (e: Expense) => locations.find((l) => l.id === e.locationId)?.name ?? "Company-wide";
  const open = expenses.find((e) => e.id === openId);
  const columns: ColumnSpec<Expense>[] = [
    {
      id: "number",
      header: "Number",
      value: (e) => e.number,
      cell: (e) => <span className="font-medium">{e.number}</span>,
    },
    { id: "date", header: "Date", value: (e) => e.date, cell: (e) => formatDate(e.date) },
    { id: "vendor", header: "Vendor", value: vendorOf },
    { id: "category", header: "Category", value: (e) => EXPENSE_CATEGORY_LABELS[e.category] },
    { id: "location", header: "Location", value: placeOf },
    { id: "cost", header: "Cost", kind: "money", value: (e) => moneyString(expenseCost(e)), total: true },
    {
      id: "status",
      header: "Status",
      value: (e) => STATUS[e.status].label,
      cell: (e) => <StatusPill {...STATUS[e.status]} />,
    },
  ];

  async function approve(expense: Expense) {
    try {
      await api.reviewExpense(expense.id, { action: "approve" });
      toast.success(`${expense.number} approved`);
      setOpenId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not approve this expense.");
    }
  }

  return (
    <>
      <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
        <Repeat aria-hidden="true" className="size-4" />
        {recurring.filter((r) => r.active).length} recurring: a draft appears each period to confirm with the actual
        amount.
        <Button size="sm" variant="ghost" onClick={() => setManaging(true)}>
          Manage recurring
        </Button>
      </p>
      <DataTable
        id="finance-expenses"
        rows={expenses}
        columns={columns}
        getRowId={(e) => e.id}
        onRowClick={(e) => setOpenId(e.id)}
        rowLabel={(e) => `Open ${e.number}`}
        searchPlaceholder="Search expenses"
        csvName="expenses"
        initialSort={{ id: "date", desc: true }}
        toolbar={
          can("finance.expense.create") ? (
            <Button onClick={() => setEditing("new")}>
              <Plus />
              New expense
            </Button>
          ) : null
        }
        empty={{ message: "No expenses yet." }}
      />
      {open ? (
        <Sheet open onOpenChange={(o) => !o && setOpenId(null)}>
          <SheetContent className="bg-surface w-full overflow-y-auto sm:max-w-md">
            <SheetHeader>
              <SheetTitle>{open.number}</SheetTitle>
              <SheetDescription>
                {EXPENSE_CATEGORY_LABELS[open.category]}, {vendorOf(open)}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 px-4 pb-6 text-sm">
              <StatusPill {...STATUS[open.status]} />
              <dl className="flex flex-col gap-1.5">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Date</dt>
                  <dd>{formatDate(open.date)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Location</dt>
                  <dd>{placeOf(open)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Amount</dt>
                  <dd>
                    <Num kind="money" value={open.amount} />
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Tax</dt>
                  <dd>
                    <Num kind="money" value={open.tax} />
                  </dd>
                </div>
                <div className="flex justify-between gap-3 font-medium">
                  <dt>Cost</dt>
                  <dd>
                    <Num kind="money" value={moneyString(expenseCost(open))} />
                  </dd>
                </div>
              </dl>
              {open.note ? <p>{open.note}</p> : null}
              {open.rejectReason ? <p className="text-danger-ink">Rejected: {open.rejectReason}</p> : null}
              {open.voidReason ? <p>Voided: {open.voidReason}</p> : null}
              {open.settlement === "on_account" ? (
                <p className="text-muted-foreground">Paid later through a supplier bill.</p>
              ) : null}
              <ul className="flex flex-col gap-1.5">
                {open.files.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      className="hover:text-brand-ink inline-flex items-center gap-2 underline-offset-2 hover:underline"
                      onClick={() => setViewing(f)}
                    >
                      <FileText aria-hidden="true" className="size-4" />
                      {f.name}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                {open.status === "draft" && can("finance.expense.create") ? (
                  <Button
                    onClick={() => {
                      setEditing(open);
                      setOpenId(null);
                    }}
                  >
                    Finish expense
                  </Button>
                ) : null}
                {open.status === "pending" && can("finance.expense.approve") && open.recordedById !== user.id ? (
                  <>
                    <Button onClick={() => void approve(open)}>Approve</Button>
                    <Button variant="outline" onClick={() => setAsking("reject")}>
                      Reject
                    </Button>
                  </>
                ) : null}
                {(open.status === "confirmed" || open.status === "pending") && can("finance.expense.void") ? (
                  <Button variant="ghost" onClick={() => setAsking("void")}>
                    Void
                  </Button>
                ) : null}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
      {editing ? (
        <ExpenseFormDialog
          expense={editing === "new" ? null : editing}
          suppliers={suppliers}
          locations={locations}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {viewing ? <FileViewerDialog file={viewing} onClose={() => setViewing(null)} /> : null}
      {managing ? (
        <RecurringExpensesSheet
          templates={recurring}
          suppliers={suppliers}
          locations={locations}
          onClose={() => setManaging(false)}
        />
      ) : null}
      {open && asking === "reject" ? (
        <ReasonDialog
          title={`Reject ${open.number}`}
          description="It goes back to draft with your reason."
          confirmLabel="Reject"
          onConfirm={(reason) => api.reviewExpense(open.id, { action: "reject", reason })}
          onClose={() => setAsking(null)}
        />
      ) : null}
      {open && asking === "void" ? (
        <ReasonDialog
          title={`Void ${open.number}`}
          description="It stays in the list as void and leaves every total."
          confirmLabel="Void expense"
          destructive
          onConfirm={(reason) => api.voidExpense(open.id, reason)}
          onClose={() => setAsking(null)}
        />
      ) : null}
    </>
  );
}
