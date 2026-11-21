"use client";

import { useState, type FormEvent } from "react";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  type ExpenseCategory,
  type Location,
  type RecurringExpense,
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
import { Num } from "@workspace/ui/components/num";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet";
import { Switch } from "@workspace/ui/components/switch";
import { Field } from "@/components/field";
import { useCan } from "@/components/workspace/workspace-context";
import { SearchPick } from "@/components/search-pick";
import { Pick } from "@/features/hr/pick";
import { api } from "@/lib/api";

const COMPANY_WIDE = "company";
const FREQUENCY = [
  ["monthly", "Every month"],
  ["quarterly", "Every quarter"],
  ["yearly", "Every year"],
] as const;
const numeric = (v: string) => v.replace(/[^\d.]/g, "");

function RecurringDialog({
  template,
  vendors,
  locations,
  onClose,
}: {
  template: RecurringExpense | null;
  vendors: readonly Supplier[];
  locations: readonly Location[];
  onClose: () => void;
}) {
  const [supplierId, setSupplierId] = useState(template?.supplierId ?? vendors[0]?.id ?? "");
  const [category, setCategory] = useState<ExpenseCategory>(template?.category ?? "rent");
  const [locationId, setLocationId] = useState(template?.locationId ?? COMPANY_WIDE);
  const [amount, setAmount] = useState(template?.amount ?? "");
  const [frequency, setFrequency] = useState<RecurringExpense["frequency"]>(template?.frequency ?? "monthly");
  const [dayOfMonth, setDay] = useState(String(template?.dayOfMonth ?? 1));
  const [startsOn, setStarts] = useState(template?.startsOn ?? api.today());
  const [note, setNote] = useState(template?.note ?? "");
  const [active, setActive] = useState(template?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api.saveRecurringExpense({
        id: template?.id,
        supplierId,
        category,
        locationId: locationId === COMPANY_WIDE ? null : locationId,
        amount,
        tax: template?.tax ?? "0.00",
        paymentMethod: template?.paymentMethod ?? "ach",
        frequency,
        dayOfMonth: Math.min(Math.max(Number(dayOfMonth) || 1, 1), 31),
        startsOn,
        endsOn: template?.endsOn ?? null,
        active,
        note,
      });
      toast.success("Recurring expense saved");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this recurring expense.");
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-surface sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{template ? "Edit recurring expense" : "New recurring expense"}</DialogTitle>
            <DialogDescription>A draft appears each period, to confirm with the actual amount.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="rex-vendor" label="Vendor">
              <SearchPick
                id="rex-vendor"
                value={supplierId}
                onChange={setSupplierId}
                searchLabel="Search vendors"
                options={vendors.map((s) => [s.id, s.name] as const)}
              />
            </Field>
            <Field id="rex-category" label="Category">
              <Pick
                id="rex-category"
                value={category}
                onChange={setCategory}
                options={EXPENSE_CATEGORIES.map((c) => [c, EXPENSE_CATEGORY_LABELS[c]] as const)}
              />
            </Field>
            <Field id="rex-location" label="Location">
              <SearchPick
                id="rex-location"
                value={locationId}
                onChange={setLocationId}
                searchLabel="Search locations"
                options={[[COMPANY_WIDE, "Company-wide"], ...locations.map((l) => [l.id, l.name] as const)]}
              />
            </Field>
            <Field id="rex-amount" label="Estimated amount">
              <Input
                id="rex-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(numeric(e.target.value))}
              />
            </Field>
            <Field id="rex-frequency" label="Repeats">
              <Pick id="rex-frequency" value={frequency} onChange={setFrequency} options={FREQUENCY} />
            </Field>
            <Field id="rex-day" label="Day of the month">
              <Input
                id="rex-day"
                inputMode="numeric"
                value={dayOfMonth}
                onChange={(e) => setDay(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
            <Field id="rex-starts" label="Starts on">
              <Input id="rex-starts" type="date" value={startsOn} onChange={(e) => setStarts(e.target.value)} />
            </Field>
            <Field id="rex-note" label="Note">
              <Input id="rex-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Switch checked={active} onCheckedChange={setActive} aria-label="Active" />
              Active
            </label>
          </div>
          {error ? (
            <p role="alert" className="text-danger-ink text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Recurring expenses (spec F1): rent and utilities that make a draft each period. */
export function RecurringExpensesSheet({
  templates,
  suppliers,
  locations,
  onClose,
}: {
  templates: readonly RecurringExpense[];
  suppliers: readonly Supplier[];
  locations: readonly Location[];
  onClose: () => void;
}) {
  const can = useCan();
  const [editing, setEditing] = useState<RecurringExpense | "new" | null>(null);
  const vendors = suppliers.filter((s) => s.type !== "goods" && s.status === "active");
  const canEdit = can("finance.expense.create");
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="bg-surface w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Recurring expenses</SheetTitle>
          <SheetDescription>
            Each makes one draft per period, waiting for the actual amount and receipt.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4 pb-6 text-sm">
          {canEdit ? (
            <div>
              <Button size="sm" onClick={() => setEditing("new")}>
                <Plus />
                New recurring expense
              </Button>
            </div>
          ) : null}
          <ul className="divide-hairline divide-y">
            {templates.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  <span className="font-medium">{EXPENSE_CATEGORY_LABELS[t.category]}</span>{" "}
                  <span className="text-muted-foreground">
                    {suppliers.find((s) => s.id === t.supplierId)?.name}
                    {t.active ? "" : ", paused"}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <Num kind="money" value={t.amount} />
                  {canEdit ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Edit ${EXPENSE_CATEGORY_LABELS[t.category]}`}
                      onClick={() => setEditing(t)}
                    >
                      <Pencil />
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
        {editing ? (
          <RecurringDialog
            template={editing === "new" ? null : editing}
            vendors={vendors}
            locations={locations}
            onClose={() => setEditing(null)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
