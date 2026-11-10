"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import type { TimeOffPolicy } from "@workspace/shared";
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
import { Switch } from "@workspace/ui/components/switch";
import { Field } from "@/components/field";
import { Pick } from "@/features/hr/pick";
import { api } from "@/lib/api";

const KINDS = [
  ["vacation", "Vacation"],
  ["sick", "Sick"],
  ["personal", "Personal"],
  ["unpaid", "Unpaid"],
] as const;
const METHODS = [
  ["per_pay_period", "Hours per pay period"],
  ["per_hour_worked", "Hours per hour worked"],
  ["annual_grant", "Hours granted each year"],
  ["none", "No accrual"],
] as const;

const BLANK: TimeOffPolicy = {
  id: "",
  name: "",
  kind: "vacation",
  paid: true,
  accrualMethod: "per_pay_period",
  accrualRate: "3.08",
  capHours: "120",
  annualUseLimitHours: "",
  carryoverHours: "",
  waitingPeriodDays: 0,
  allowNegative: false,
};

const numeric = (v: string) => v.replace(/[^\d.]/g, "");

/** Adds or edits a time-off policy (spec C1, ADR 0024). California staff get the guards in the store. */
export function PolicyDialog({ policy, onClose }: { policy: TimeOffPolicy | null; onClose: () => void }) {
  const [draft, setDraft] = useState(policy ?? BLANK);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<TimeOffPolicy>) => setDraft({ ...draft, ...patch });
  const num = (key: "accrualRate" | "capHours" | "annualUseLimitHours" | "carryoverHours", label: string) => (
    <Field id={`pol-${key}`} label={label}>
      <Input
        id={`pol-${key}`}
        inputMode="decimal"
        value={draft[key]}
        onChange={(e) => set({ [key]: numeric(e.target.value) })}
      />
    </Field>
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api.saveTimeOffPolicy(draft);
      toast.success("Policy saved");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this policy.");
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-surface sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{policy ? `Edit ${policy.name}` : "New time-off policy"}</DialogTitle>
            <DialogDescription>A cap pauses accrual at that balance. Leave a limit empty for none.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="pol-name" label="Name">
              <Input id="pol-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field id="pol-kind" label="Kind">
              <Pick
                id="pol-kind"
                value={draft.kind}
                onChange={(kind) => set({ kind, paid: kind !== "unpaid" })}
                options={KINDS}
              />
            </Field>
            <Field id="pol-method" label="Accrual">
              <Pick
                id="pol-method"
                value={draft.accrualMethod}
                onChange={(accrualMethod) => set({ accrualMethod })}
                options={METHODS}
              />
            </Field>
            {num("accrualRate", "Accrual rate")}
            {num("capHours", "Cap, hours")}
            {num("annualUseLimitHours", "Yearly use limit, hours")}
            {num("carryoverHours", "Carryover limit, hours")}
            <Field id="pol-wait" label="Waiting period, days">
              <Input
                id="pol-wait"
                inputMode="numeric"
                value={String(draft.waitingPeriodDays)}
                onChange={(e) => set({ waitingPeriodDays: Number(numeric(e.target.value)) || 0 })}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Switch
                checked={draft.allowNegative}
                onCheckedChange={(allowNegative) => set({ allowNegative })}
                aria-label="Allow a negative balance"
              />
              Allow a negative balance
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
            <Button type="submit">Save policy</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
