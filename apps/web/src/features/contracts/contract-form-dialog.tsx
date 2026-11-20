"use client";

import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  dec,
  retainageWarning,
  sum,
  US_STATES,
  type Contract,
  type ContractLine,
  type Customer,
  type Location,
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
import { Textarea } from "@workspace/ui/components/textarea";
import { Field } from "@/components/field";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { Pick } from "@/features/hr/pick";
import { api } from "@/lib/api";
import type { ContractInput } from "@/lib/api/contract";

const DIRECTION = [
  ["customer", "Customer contract"],
  ["subcontractor", "Subcontractor contract"],
] as const;
const KIND = [
  ["project", "Project contract"],
  ["master", "Master agreement"],
] as const;
const TAX = [
  ["on_billing", "Tax each billing, retained money included"],
  ["on_release", "Tax the retained part when it is released"],
  ["contractor_pays", "Contractor pays the tax, none on the invoice"],
] as const;
const CATEGORY = [
  ["material", "Materials"],
  ["labor", "Labor"],
  ["service", "Service"],
  ["freight", "Freight"],
] as const;
const BILLING = [
  ["percent", "Bill by progress"],
  ["milestone", "Bill as a milestone"],
] as const;

type Row = ContractInput["lines"][number];

const blankLine = (n: number): Row => ({
  code: `L${n}`,
  description: "",
  category: "material",
  billing: "percent",
  scheduledValue: "",
  retainagePct: null,
  storedRetainagePct: null,
  milestoneDueAt: null,
  estimatedCost: "0.00",
});

const numeric = (v: string) => v.replace(/[^\d.]/g, "");

/** Adds or edits a draft contract and its schedule of values (spec D1, ADR 0026). */
export function ContractFormDialog({
  contract,
  lines,
  customers,
  suppliers,
  locations,
  onClose,
  onSaved,
}: {
  contract: Contract | null;
  lines: readonly ContractLine[];
  customers: readonly Customer[];
  suppliers: readonly Supplier[];
  locations: readonly Location[];
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { user } = useWorkspace();
  const seesCost = useCan()("contracts.contract.view_sensitive");
  const today = api.today();
  const site = locations[0]?.address ?? { street: "", city: "", state: "", zip: "" };
  const [draft, setDraft] = useState<ContractInput>(
    contract
      ? { ...contract, lines: lines.map((l) => ({ ...l })) }
      : {
          direction: "customer",
          kind: "project",
          customerId: customers[0]?.id ?? null,
          supplierId: null,
          title: "",
          scope: "",
          // The demo files a new contract under this branch. The API files it under its creator's own
          // and is never sent one (api-methods.ts `contractBody`; ADR 0044).
          branchId: user.branchId,
          locationId: locations[0]?.id ?? "",
          jobSite: { ...site },
          salesRepId: user.id,
          startsAt: today,
          endsAt: new Date(Date.parse(today) + 180 * 86_400_000).toISOString().slice(0, 10),
          renewal: { mode: "none", noticeDays: 30 },
          retainagePct: "5",
          storedRetainagePct: "5",
          bondInLieu: false,
          taxTreatment: "on_billing",
          notes: "",
          lines: [blankLine(1)],
        },
  );
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<ContractInput>) => setDraft({ ...draft, ...patch });
  const setLine = (i: number, patch: Partial<Row>) =>
    set({ lines: draft.lines.map((l, at) => (at === i ? { ...l, ...patch } : l)) });
  const total = sum(draft.lines.map((l) => (l.scheduledValue ? dec(l.scheduledValue) : dec(0))));
  const warning =
    draft.kind === "project"
      ? retainageWarning(draft.jobSite.state, draft.retainagePct || "0", total.toString())
      : null;
  const toCustomer = draft.direction === "customer";
  const parties = toCustomer ? customers : suppliers.filter((s) => s.status === "active");

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const saved = await api.saveContract({ ...draft, id: contract?.id });
      toast.success(contract ? "Contract saved" : `${saved.number} created`);
      onSaved(saved.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this contract.");
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-surface max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{contract ? `Edit ${contract.number}` : "New contract"}</DialogTitle>
            <DialogDescription>
              A draft can change freely. Once sent, changes go through change orders.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="ctr-direction" label="With">
              <Pick
                id="ctr-direction"
                value={draft.direction}
                onChange={(direction) =>
                  set(
                    direction === "customer"
                      ? { direction, customerId: customers[0]?.id ?? null, supplierId: null }
                      : {
                          direction,
                          customerId: null,
                          supplierId: suppliers.find((s) => s.status === "active")?.id ?? null,
                        },
                  )
                }
                options={DIRECTION}
              />
            </Field>
            <Field id="ctr-kind" label="Type">
              <Pick id="ctr-kind" value={draft.kind} onChange={(kind) => set({ kind })} options={KIND} />
            </Field>
            <Field id="ctr-party" label={toCustomer ? "Customer" : "Subcontractor"}>
              <Pick
                id="ctr-party"
                value={(toCustomer ? draft.customerId : draft.supplierId) ?? ""}
                onChange={(id) => set(toCustomer ? { customerId: id } : { supplierId: id })}
                options={parties.map((p) => [p.id, p.name] as const)}
              />
            </Field>
            <Field id="ctr-title" label="Title">
              <Input id="ctr-title" value={draft.title} onChange={(e) => set({ title: e.target.value })} />
            </Field>
            <Field id="ctr-scope" label="Scope" className="sm:col-span-2">
              <Textarea id="ctr-scope" value={draft.scope} onChange={(e) => set({ scope: e.target.value })} />
            </Field>
            <Field id="ctr-start" label="Start date">
              <Input
                id="ctr-start"
                type="date"
                value={draft.startsAt}
                onChange={(e) => set({ startsAt: e.target.value })}
              />
            </Field>
            <Field id="ctr-end" label="End date">
              <Input id="ctr-end" type="date" value={draft.endsAt} onChange={(e) => set({ endsAt: e.target.value })} />
            </Field>
            <Field id="ctr-street" label="Job site street">
              <Input
                id="ctr-street"
                value={draft.jobSite.street}
                onChange={(e) => set({ jobSite: { ...draft.jobSite, street: e.target.value } })}
              />
            </Field>
            <Field id="ctr-city" label="Job site city">
              <Input
                id="ctr-city"
                value={draft.jobSite.city}
                onChange={(e) => set({ jobSite: { ...draft.jobSite, city: e.target.value } })}
              />
            </Field>
            <Field id="ctr-state" label="Job site state" hint="Sets the tax rule and any retainage limit.">
              <Pick
                id="ctr-state"
                value={draft.jobSite.state}
                onChange={(state) => set({ jobSite: { ...draft.jobSite, state } })}
                options={US_STATES}
              />
            </Field>
            <Field id="ctr-zip" label="Job site ZIP">
              <Input
                id="ctr-zip"
                value={draft.jobSite.zip}
                onChange={(e) => set({ jobSite: { ...draft.jobSite, zip: e.target.value } })}
              />
            </Field>
            {draft.kind === "project" ? (
              <>
                <Field id="ctr-retainage" label="Retainage %">
                  <Input
                    id="ctr-retainage"
                    inputMode="decimal"
                    value={draft.retainagePct}
                    onChange={(e) =>
                      set({ retainagePct: numeric(e.target.value), storedRetainagePct: numeric(e.target.value) })
                    }
                  />
                </Field>
                <Field id="ctr-tax" label="Sales tax" hint="An example: confirm with your accountant.">
                  <Pick
                    id="ctr-tax"
                    value={draft.taxTreatment}
                    onChange={(taxTreatment) => set({ taxTreatment })}
                    options={TAX}
                  />
                </Field>
              </>
            ) : (
              <Field id="ctr-notes" label="Pricing and terms" className="sm:col-span-2">
                <Textarea id="ctr-notes" value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
              </Field>
            )}
          </div>
          {warning ? <p className="text-warning-ink bg-warning/14 rounded-md p-3 text-sm">{warning}</p> : null}
          {draft.kind === "project" ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Schedule of values</h3>
              {draft.lines.map((line, i) => (
                <div key={i} className="grid items-end gap-2 sm:grid-cols-[4.5rem_1fr_7rem_8rem_7rem_7rem_auto]">
                  <Field id={`ln-code-${i}`} label="Code">
                    <Input
                      id={`ln-code-${i}`}
                      value={line.code}
                      onChange={(e) => setLine(i, { code: e.target.value })}
                    />
                  </Field>
                  <Field id={`ln-desc-${i}`} label="Description">
                    <Input
                      id={`ln-desc-${i}`}
                      value={line.description}
                      onChange={(e) => setLine(i, { description: e.target.value })}
                    />
                  </Field>
                  <Field id={`ln-cat-${i}`} label="Category">
                    <Pick
                      id={`ln-cat-${i}`}
                      value={line.category}
                      onChange={(category) => setLine(i, { category })}
                      options={CATEGORY}
                    />
                  </Field>
                  <Field id={`ln-bill-${i}`} label="Billing">
                    <Pick
                      id={`ln-bill-${i}`}
                      value={line.billing}
                      onChange={(billing) => setLine(i, { billing })}
                      options={BILLING}
                    />
                  </Field>
                  <Field id={`ln-value-${i}`} label="Value">
                    <Input
                      id={`ln-value-${i}`}
                      inputMode="decimal"
                      value={line.scheduledValue}
                      onChange={(e) => setLine(i, { scheduledValue: numeric(e.target.value) })}
                    />
                  </Field>
                  {seesCost ? (
                    <Field id={`ln-cost-${i}`} label="Est. cost">
                      <Input
                        id={`ln-cost-${i}`}
                        inputMode="decimal"
                        value={line.estimatedCost}
                        onChange={(e) => setLine(i, { estimatedCost: numeric(e.target.value) })}
                      />
                    </Field>
                  ) : null}
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove line ${i + 1}`}
                    onClick={() => set({ lines: draft.lines.filter((_, at) => at !== i) })}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => set({ lines: [...draft.lines, blankLine(draft.lines.length + 1)] })}
                >
                  <Plus />
                  Add line
                </Button>
                <p className="text-sm">
                  Contract value: <Num kind="money" value={total.toString()} />
                </p>
              </div>
            </section>
          ) : null}
          {error ? (
            <p role="alert" className="text-danger-ink text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save contract</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
