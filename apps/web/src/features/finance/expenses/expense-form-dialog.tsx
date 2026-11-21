"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  PAYMENT_METHOD_LABELS,
  type Expense,
  type ExpenseCategory,
  type Location,
  type PaymentMethod,
  type Supplier,
} from "@workspace/shared";
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
import { Field } from "@/components/field";
import { SearchPick } from "@/components/search-pick";
import { Pick } from "@/features/hr/pick";
import { ProofFilesField } from "@/features/invoices/payments/proof-files-field";
import { api } from "@/lib/api";

const COMPANY_WIDE = "company";
const money = (v: string) => v.replace(/[^\d.]/g, "");

/** Records an expense or saves a draft (spec F1): the vendor comes from the directory and a receipt is required to record it. */
export function ExpenseFormDialog({
  expense,
  suppliers,
  locations,
  onClose,
}: {
  expense: Expense | null;
  suppliers: readonly Supplier[];
  locations: readonly Location[];
  onClose: () => void;
}) {
  const vendors = suppliers.filter((s) => s.type !== "goods" && s.status === "active");
  const [date, setDate] = useState(expense?.date ?? api.today());
  const [supplierId, setSupplierId] = useState(expense?.supplierId ?? vendors[0]?.id ?? "");
  const [category, setCategory] = useState<ExpenseCategory>(expense?.category ?? "rent");
  const [locationId, setLocationId] = useState(expense?.locationId ?? COMPANY_WIDE);
  const [amount, setAmount] = useState(expense?.amount ?? "");
  const [tax, setTax] = useState(expense?.tax ?? "");
  const [paymentMethod, setMethod] = useState<PaymentMethod>(expense?.paymentMethod ?? "ach");
  const [reference, setReference] = useState(expense?.reference ?? "");
  const [note, setNote] = useState(expense?.note ?? "");
  const [settlement, setSettlement] = useState<Expense["settlement"]>(expense?.settlement ?? "paid");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const salesTax = category === "sales_tax_payment";

  async function save(asDraft: boolean) {
    try {
      const saved = await api.saveExpense(
        {
          id: expense?.id,
          date,
          supplierId,
          category,
          locationId: locationId === COMPANY_WIDE ? null : locationId,
          amount,
          tax,
          paymentMethod,
          reference,
          note,
          settlement,
          dueAt: null,
          asDraft,
        },
        files,
      );
      toast.success(
        saved.status === "draft"
          ? "Draft saved"
          : saved.status === "pending"
            ? "Sent for approval"
            : `Expense ${saved.number} recorded`,
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this expense.");
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void save(false);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-surface max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{expense ? `Finish ${expense.number}` : "New expense"}</DialogTitle>
            <DialogDescription>A draft needs no receipt. Recording an expense does.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="exp-date" label="Date">
              <Input id="exp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field id="exp-vendor" label="Vendor">
              <SearchPick
                id="exp-vendor"
                value={supplierId}
                onChange={setSupplierId}
                searchLabel="Search vendors"
                options={vendors.map((s) => [s.id, s.name] as const)}
              />
            </Field>
            <Field id="exp-category" label="Category">
              <Pick
                id="exp-category"
                value={category}
                onChange={setCategory}
                options={EXPENSE_CATEGORIES.map((c) => [c, EXPENSE_CATEGORY_LABELS[c]] as const)}
              />
            </Field>
            {salesTax ? null : (
              <Field id="exp-location" label="Location">
                <SearchPick
                  id="exp-location"
                  value={locationId}
                  onChange={setLocationId}
                  searchLabel="Search locations"
                  options={[[COMPANY_WIDE, "Company-wide"], ...locations.map((l) => [l.id, l.name] as const)]}
                />
              </Field>
            )}
            <Field id="exp-amount" label="Amount before tax">
              <Input
                id="exp-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(money(e.target.value))}
              />
            </Field>
            {salesTax ? null : (
              <Field id="exp-tax" label="Tax">
                <Input id="exp-tax" inputMode="decimal" value={tax} onChange={(e) => setTax(money(e.target.value))} />
              </Field>
            )}
            <Field id="exp-method" label="Payment method">
              <Pick
                id="exp-method"
                value={paymentMethod}
                onChange={setMethod}
                options={Object.entries(PAYMENT_METHOD_LABELS) as [PaymentMethod, string][]}
              />
            </Field>
            <Field id="exp-reference" label="Reference">
              <Input id="exp-reference" value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
            <Field id="exp-settle" label="Payment">
              <Pick
                id="exp-settle"
                value={settlement}
                onChange={setSettlement}
                options={[
                  ["paid", "Paid already"],
                  ["on_account", "Pay later"],
                ]}
              />
            </Field>
            <Field id="exp-note" label="Note">
              <Input id="exp-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          <ProofFilesField
            id="exp-receipt"
            files={files}
            onChange={setFiles}
            label="Receipt"
            dropHint="the receipt, statement or lease"
          />
          {error ? (
            <p role="alert" className="text-danger-ink text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" variant="outline" onClick={() => void save(true)}>
              Save as draft
            </Button>
            <Button type="submit">Record expense</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
