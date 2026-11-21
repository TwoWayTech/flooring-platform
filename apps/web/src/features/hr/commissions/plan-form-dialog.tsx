"use client";

import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { commissionPlanProblem, type CommissionPlan } from "@workspace/shared";
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
import { useStepUp } from "@/components/use-step-up";
import { api } from "@/lib/api";
import { Pick } from "../pick";

const BASIS = [
  ["paid_revenue", "Paid revenue"],
  ["gross_margin", "Gross margin"],
] as const;
const MODE = [
  ["marginal", "Marginal: each rate on its own band"],
  ["retroactive", "Retroactive: the rate reached applies to all"],
] as const;
const DRAW = [
  ["none", "No draw"],
  ["recoverable", "Recoverable draw"],
  ["non_recoverable", "Guaranteed draw"],
] as const;

const blank = (today: string): CommissionPlan => ({
  id: "",
  name: "",
  version: 1,
  status: "active",
  effectiveFrom: today,
  effectiveTo: null,
  basis: "paid_revenue",
  baseRatePct: "5",
  monthlyTarget: "50000",
  tierMode: "marginal",
  tiers: [{ fromPctOfTarget: "100", ratePct: "6" }],
  overridePct: "0",
  draw: { kind: "none", monthlyAmount: "0" },
  clawbackDays: 90,
});

const numeric = (v: string) => v.replace(/[^\d.]/g, "");

/**
 * Adds or edits a commission plan (spec C1, ADR 0025). A plan already used by an approved statement
 * becomes a new version; the rep signs it again.
 */
export function PlanFormDialog({ plan, onClose }: { plan: CommissionPlan | null; onClose: () => void }) {
  const [draft, setDraft] = useState(plan ?? blank(api.today()));
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<CommissionPlan>) => setDraft({ ...draft, ...patch });
  const stepUp = useStepUp();

  /**
   * A plan is a rule pay follows, so the API asks for a fresh code to save one (ADR 0063); the
   * shared rule runs first, so a refused plan never costs a code.
   */
  function submit(event: FormEvent) {
    event.preventDefault();
    const problem = commissionPlanProblem(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    stepUp.ask(plan ? `Saving ${plan.name}` : "Adding a commission plan", save);
  }

  async function save() {
    try {
      await api.saveCommissionPlan(draft);
      toast.success("Plan saved");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this plan.");
    }
  }

  const num = (id: string, label: string, value: string, onChange: (v: string) => void) => (
    <Field id={id} label={label}>
      <Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(numeric(e.target.value))} />
    </Field>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-surface max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{plan ? `Edit ${plan.name}` : "New commission plan"}</DialogTitle>
            <DialogDescription>
              Commission is advanced when a customer payment is confirmed and earned when the clawback window closes.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="plan-name" label="Plan name" className="sm:col-span-2">
              <Input id="plan-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field id="plan-basis" label="Paid on">
              <Pick id="plan-basis" value={draft.basis} onChange={(basis) => set({ basis })} options={BASIS} />
            </Field>
            {num("plan-rate", "Base rate %", draft.baseRatePct, (baseRatePct) => set({ baseRatePct }))}
            {num("plan-target", "Monthly target $", draft.monthlyTarget, (monthlyTarget) => set({ monthlyTarget }))}
            <Field id="plan-mode" label="Tiers">
              <Pick id="plan-mode" value={draft.tierMode} onChange={(tierMode) => set({ tierMode })} options={MODE} />
            </Field>
          </div>
          <div className="flex flex-col gap-2">
            {draft.tiers.map((tier, i) => (
              <div key={i} className="flex items-end gap-2">
                <Field id={`tier-from-${i}`} label="From % of target">
                  <Input
                    id={`tier-from-${i}`}
                    inputMode="decimal"
                    value={tier.fromPctOfTarget}
                    onChange={(e) =>
                      set({
                        tiers: draft.tiers.map((t, at) =>
                          at === i ? { ...t, fromPctOfTarget: numeric(e.target.value) } : t,
                        ),
                      })
                    }
                  />
                </Field>
                <Field id={`tier-rate-${i}`} label="Rate %">
                  <Input
                    id={`tier-rate-${i}`}
                    inputMode="decimal"
                    value={tier.ratePct}
                    onChange={(e) =>
                      set({
                        tiers: draft.tiers.map((t, at) => (at === i ? { ...t, ratePct: numeric(e.target.value) } : t)),
                      })
                    }
                  />
                </Field>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove tier ${i + 1}`}
                  onClick={() => set({ tiers: draft.tiers.filter((_, at) => at !== i) })}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => set({ tiers: [...draft.tiers, { fromPctOfTarget: "150", ratePct: "7" }] })}
              >
                <Plus />
                Add tier
              </Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {num("plan-override", "Manager override %", draft.overridePct, (overridePct) => set({ overridePct }))}
            <Field id="plan-clawback" label="Clawback window, days">
              <Input
                id="plan-clawback"
                inputMode="numeric"
                value={String(draft.clawbackDays)}
                onChange={(e) => set({ clawbackDays: Number(numeric(e.target.value)) || 0 })}
              />
            </Field>
            <Field id="plan-draw" label="Draw">
              <Pick
                id="plan-draw"
                value={draft.draw.kind}
                onChange={(kind) => set({ draw: { ...draft.draw, kind } })}
                options={DRAW}
              />
            </Field>
            {draft.draw.kind !== "none"
              ? num("plan-draw-amount", "Draw per month $", draft.draw.monthlyAmount, (monthlyAmount) =>
                  set({ draw: { ...draft.draw, monthlyAmount } }),
                )
              : null}
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
            <Button type="submit">Save plan</Button>
          </DialogFooter>
        </form>
        {stepUp.dialog}
      </DialogContent>
    </Dialog>
  );
}
