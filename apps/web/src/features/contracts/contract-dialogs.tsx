"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  billingFigures,
  dec,
  lineRates,
  lineToDate,
  moneyString,
  sum,
  type BillingLine,
  type ChangeOrder,
  type Contract,
  type ContractBilling,
  type ContractLine,
  type InsuranceCertificate,
  type InsuranceCoverage,
  type LienWaiverType,
  type Payment,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
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
import { Field } from "@/components/field";
import { ScrollRegion } from "@/components/scroll-region";
import { Pick } from "@/features/hr/pick";
import { api } from "@/lib/api";

const numeric = (v: string) => v.replace(/[^\d.]/g, "");

/** The frame every contract dialog shares: title, one form, error line and two buttons. */
function FormDialog({
  title,
  description,
  confirm,
  wide,
  onSubmit,
  onClose,
  children,
}: {
  title: string;
  description: string;
  confirm: string;
  wide?: boolean;
  onSubmit: () => Promise<string>;
  onClose: () => void;
  children: ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      toast.success(await onSubmit());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not save.");
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={`bg-surface max-h-[90dvh] overflow-y-auto ${wide ? "sm:max-w-3xl" : "sm:max-w-md"}`}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
          {error ? (
            <p role="alert" className="text-danger-ink text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">{confirm}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Records a simulated signature: typed name and role (spec D2). */
export function SignDialog({ contract, signer, onClose }: { contract: Contract; signer: string; onClose: () => void }) {
  const [name, setName] = useState(signer);
  const [role, setRole] = useState("Authorized signer");
  return (
    <FormDialog
      title={`Record signature on ${contract.number}`}
      description="This is a simulated signature for the demo. A real signature would come from a signing provider."
      confirm="Record signature"
      onClose={onClose}
      onSubmit={async () => {
        await api.signContract(contract.id, { signerName: name, signerRole: role });
        return "Signature recorded";
      }}
    >
      <Field id="sign-name" label="Signer's full name">
        <Input id="sign-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field id="sign-role" label="Role">
        <Input id="sign-role" value={role} onChange={(e) => setRole(e.target.value)} />
      </Field>
    </FormDialog>
  );
}

/** A pay application: cumulative work and stored materials per line, with the amounts it will bill (ADR 0026). */
export function BillingDialog({
  contract,
  lines,
  billings,
  onClose,
}: {
  contract: Contract;
  lines: readonly ContractLine[];
  billings: readonly ContractBilling[];
  onClose: () => void;
}) {
  const [periodEnd, setPeriodEnd] = useState(api.today());
  const [inputs, setInputs] = useState<BillingLine[]>(() =>
    lines.map((line) => {
      const { completed, stored } = lineToDate(line.id, billings);
      return {
        lineId: line.id,
        completedToDate: completed.toString(),
        storedBalance: stored.toString(),
        ...lineRates(line, contract),
      };
    }),
  );
  const set = (lineId: string, patch: Partial<BillingLine>) =>
    setInputs(inputs.map((l) => (l.lineId === lineId ? { ...l, ...patch } : l)));
  const safe = inputs.map((l) => ({
    ...l,
    completedToDate: l.completedToDate || "0",
    storedBalance: l.storedBalance || "0",
  }));
  const figures = billingFigures(safe, billings);
  return (
    <FormDialog
      title={`New billing on ${contract.number}`}
      description="Enter the totals to date. The billing is the change since the last one."
      confirm="Post billing"
      wide
      onClose={onClose}
      onSubmit={async () => {
        const billing = await api.postBilling(contract.id, { periodEnd, lines: safe });
        return `Billing ${billing.number} posted`;
      }}
    >
      <Field id="bill-period" label="Period ending" className="sm:w-48">
        <Input id="bill-period" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
      </Field>
      <ScrollRegion label="Billing lines">
        <table className="w-full min-w-[38rem] text-sm">
          <thead className="text-muted-foreground text-left text-xs">
            <tr>
              <th className="py-1 font-medium">Line</th>
              <th className="py-1 text-right font-medium">Value</th>
              <th className="py-1 font-medium">Work to date</th>
              <th className="py-1 font-medium">Stored materials</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const input = inputs.find((l) => l.lineId === line.id)!;
              const milestone = line.billing === "milestone";
              return (
                <tr key={line.id} className="border-hairline border-t">
                  <td className="py-1.5 pr-2">
                    {line.code} {line.description}
                  </td>
                  <td className="py-1.5 pr-2 text-right">
                    <Num kind="money" value={line.scheduledValue} />
                  </td>
                  <td className="py-1.5 pr-2">
                    {milestone ? (
                      <label className="flex items-center gap-2">
                        <Checkbox
                          checked={dec(input.completedToDate || 0).gte(line.scheduledValue)}
                          onCheckedChange={(v) =>
                            set(line.id, { completedToDate: v === true ? line.scheduledValue : "0" })
                          }
                          aria-label={`${line.code} complete`}
                        />
                        Complete
                      </label>
                    ) : (
                      <Input
                        aria-label={`${line.code} work to date`}
                        inputMode="decimal"
                        value={input.completedToDate}
                        onChange={(e) => set(line.id, { completedToDate: numeric(e.target.value) })}
                      />
                    )}
                  </td>
                  <td className="py-1.5">
                    {milestone ? null : (
                      <Input
                        aria-label={`${line.code} stored materials`}
                        inputMode="decimal"
                        value={input.storedBalance}
                        onChange={(e) => set(line.id, { storedBalance: numeric(e.target.value) })}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollRegion>
      <p className="text-sm">
        This billing: <Num kind="money" value={figures.gross.toString()} />, of which{" "}
        <Num kind="money" value={figures.withheld.toString()} /> is retained.
      </p>
    </FormDialog>
  );
}

/** Releases held retainage, in part or in full, on its own invoice or bill (spec D2). */
export function ReleaseDialog({ contract, held, onClose }: { contract: Contract; held: string; onClose: () => void }) {
  const [amount, setAmount] = useState(held);
  return (
    <FormDialog
      title={`Release retainage on ${contract.number}`}
      description="The released amount goes on its own invoice or bill and starts to age from today."
      confirm="Release retainage"
      onClose={onClose}
      onSubmit={async () => {
        await api.releaseRetainage(contract.id, { amount });
        return "Retainage released";
      }}
    >
      <Field id="rel-amount" label="Amount">
        <Input
          id="rel-amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(numeric(e.target.value))}
        />
      </Field>
      <p className="text-muted-foreground text-sm">
        Held now: <Num kind="money" value={held} />
      </p>
    </FormDialog>
  );
}

const NEW_LINE = "new";
const CATEGORY = [
  ["material", "Materials"],
  ["labor", "Labor"],
  ["service", "Service"],
] as const;

/** A change order: what changes, why, and by how much (spec D2). */
export function ChangeOrderDialog({
  contract,
  lines,
  onClose,
}: {
  contract: Contract;
  lines: readonly ContractLine[];
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [rows, setRows] = useState<ChangeOrder["lines"]>([
    { lineId: null, description: "", category: "material", amountDelta: "" },
  ]);
  const setRow = (i: number, patch: Partial<ChangeOrder["lines"][number]>) =>
    setRows(rows.map((r, at) => (at === i ? { ...r, ...patch } : r)));
  const total = sum(rows.map((r) => (/^-?\d/.test(r.amountDelta) ? r.amountDelta : "0")));
  return (
    <FormDialog
      title={`Change order on ${contract.number}`}
      description="It goes for approval. Once approved the contract value changes at once; invoices already issued do not."
      confirm="Submit for approval"
      wide
      onClose={onClose}
      onSubmit={async () => {
        const order = await api.saveChangeOrder(contract.id, { reason, lines: rows });
        return `${order.number} submitted`;
      }}
    >
      <Field id="co-reason" label="Reason">
        <Input id="co-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {rows.map((row, i) => (
        <div key={i} className="grid items-end gap-2 sm:grid-cols-[12rem_1fr_8rem_8rem_auto]">
          <Field id={`co-line-${i}`} label="Line">
            <Pick
              id={`co-line-${i}`}
              value={row.lineId ?? NEW_LINE}
              onChange={(v) => {
                const line = lines.find((l) => l.id === v);
                setRow(
                  i,
                  line ? { lineId: line.id, description: line.description, category: line.category } : { lineId: null },
                );
              }}
              options={[[NEW_LINE, "New line"], ...lines.map((l) => [l.id, `${l.code} ${l.description}`] as const)]}
            />
          </Field>
          <Field id={`co-desc-${i}`} label="Description">
            <Input
              id={`co-desc-${i}`}
              value={row.description}
              onChange={(e) => setRow(i, { description: e.target.value })}
            />
          </Field>
          <Field id={`co-cat-${i}`} label="Category">
            <Pick
              id={`co-cat-${i}`}
              value={row.category === "freight" ? "service" : row.category}
              onChange={(category) => setRow(i, { category })}
              options={CATEGORY}
            />
          </Field>
          <Field id={`co-amt-${i}`} label="Amount">
            <Input
              id={`co-amt-${i}`}
              inputMode="decimal"
              placeholder="500 or -250"
              value={row.amountDelta}
              onChange={(e) => setRow(i, { amountDelta: e.target.value.replace(/[^\d.-]/g, "") })}
            />
          </Field>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={`Remove row ${i + 1}`}
            onClick={() => setRows(rows.filter((_, at) => at !== i))}
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
          onClick={() => setRows([...rows, { lineId: null, description: "", category: "material", amountDelta: "" }])}
        >
          <Plus />
          Add row
        </Button>
        <p className="text-sm">
          Change in value: <Num kind="money" value={moneyString(total)} />
        </p>
      </div>
    </FormDialog>
  );
}

const WAIVER_TYPES = [
  ["conditional_progress", "Conditional, progress"],
  ["unconditional_progress", "Unconditional, progress"],
  ["conditional_final", "Conditional, final"],
  ["unconditional_final", "Unconditional, final"],
] as const;
const NO_PAYMENT = "none";

/** Records a lien waiver; an unconditional one needs a confirmed payment (ADR 0026). */
export function WaiverDialog({
  contract,
  payments,
  onClose,
}: {
  contract: Contract;
  payments: readonly Payment[];
  onClose: () => void;
}) {
  const [type, setType] = useState<LienWaiverType>("conditional_progress");
  const [amount, setAmount] = useState("");
  const [paymentId, setPaymentId] = useState(NO_PAYMENT);
  const [throughDate, setThrough] = useState(api.today());
  const [statutoryForm, setStatutory] = useState(false);
  return (
    <FormDialog
      title={`Record a lien waiver on ${contract.number}`}
      description="The demo records waivers and does not write the legal form."
      confirm="Record waiver"
      onClose={onClose}
      onSubmit={async () => {
        await api.recordWaiver(contract.id, {
          type,
          amount,
          paymentId: paymentId === NO_PAYMENT ? null : paymentId,
          supplierPaymentId: null,
          throughDate,
          statutoryForm,
        });
        return "Waiver recorded";
      }}
    >
      <Field id="lw-type" label="Type">
        <Pick id="lw-type" value={type} onChange={setType} options={WAIVER_TYPES} />
      </Field>
      <Field id="lw-amount" label="Amount">
        <Input id="lw-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(numeric(e.target.value))} />
      </Field>
      <Field id="lw-payment" label="Payment">
        <Pick
          id="lw-payment"
          value={paymentId}
          onChange={setPaymentId}
          options={[[NO_PAYMENT, "None yet"], ...payments.map((p) => [p.id, `${p.number}, ${p.amount}`] as const)]}
        />
      </Field>
      <Field id="lw-through" label="Through date">
        <Input id="lw-through" type="date" value={throughDate} onChange={(e) => setThrough(e.target.value)} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={statutoryForm}
          onCheckedChange={(v) => setStatutory(v === true)}
          aria-label="State statutory form"
        />
        State statutory form
      </label>
    </FormDialog>
  );
}

const COVERAGE_TYPES = [
  ["general", "General liability"],
  ["auto", "Auto"],
  ["umbrella", "Umbrella"],
  ["workers_comp", "Workers' compensation"],
] as const;

/** A subcontractor's certificate, one expiry per coverage (ADR 0026). */
export function InsuranceDialog({
  contract,
  certificate,
  onClose,
}: {
  contract: Contract;
  certificate: InsuranceCertificate | null;
  onClose: () => void;
}) {
  const today = api.today();
  const blank: InsuranceCoverage = {
    type: "general",
    insurer: "",
    policyNumber: "",
    effectiveOn: today,
    expiresOn: "",
    limits: "",
  };
  const [producer, setProducer] = useState(certificate?.producer ?? "");
  const [holder, setHolder] = useState(certificate?.holder ?? "");
  const [coverages, setCoverages] = useState(certificate?.coverages ?? [blank]);
  const setRow = (i: number, patch: Partial<InsuranceCoverage>) =>
    setCoverages(coverages.map((c, at) => (at === i ? { ...c, ...patch } : c)));
  return (
    <FormDialog
      title={`Insurance certificate for ${contract.number}`}
      description="The earliest expiry sets the status. Alerts go out 60, 30 and 7 days before."
      confirm="Save certificate"
      wide
      onClose={onClose}
      onSubmit={async () => {
        await api.saveCertificate(contract.id, {
          producer,
          holder,
          coverages,
          additionalInsured: certificate?.additionalInsured ?? false,
        });
        return "Certificate saved";
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="coi-producer" label="Agency">
          <Input id="coi-producer" value={producer} onChange={(e) => setProducer(e.target.value)} />
        </Field>
        <Field id="coi-holder" label="Certificate holder">
          <Input id="coi-holder" value={holder} onChange={(e) => setHolder(e.target.value)} />
        </Field>
      </div>
      {coverages.map((row, i) => (
        <div key={i} className="grid items-end gap-2 sm:grid-cols-[12rem_1fr_1fr_9rem]">
          <Field id={`cov-type-${i}`} label="Coverage">
            <Pick
              id={`cov-type-${i}`}
              value={row.type}
              onChange={(type) => setRow(i, { type })}
              options={COVERAGE_TYPES}
            />
          </Field>
          <Field id={`cov-insurer-${i}`} label="Insurer">
            <Input
              id={`cov-insurer-${i}`}
              value={row.insurer}
              onChange={(e) => setRow(i, { insurer: e.target.value })}
            />
          </Field>
          <Field id={`cov-policy-${i}`} label="Policy number">
            <Input
              id={`cov-policy-${i}`}
              value={row.policyNumber}
              onChange={(e) => setRow(i, { policyNumber: e.target.value })}
            />
          </Field>
          <Field id={`cov-exp-${i}`} label="Expires">
            <Input
              id={`cov-exp-${i}`}
              type="date"
              value={row.expiresOn}
              onChange={(e) => setRow(i, { expiresOn: e.target.value })}
            />
          </Field>
        </div>
      ))}
      <div>
        <Button type="button" size="sm" variant="ghost" onClick={() => setCoverages([...coverages, blank])}>
          <Plus />
          Add coverage
        </Button>
      </div>
    </FormDialog>
  );
}
