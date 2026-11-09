"use client";

import { Check, Circle } from "lucide-react";
import {
  dec,
  depositAmount,
  type Invoice,
  type InvoiceLedger,
  type Job,
  type Payment,
  type User,
} from "@workspace/shared";
import { Panel } from "@workspace/ui/components/panel";
import { cn } from "@workspace/ui/lib/utils";
import { useFormatDate } from "@/lib/use-format-date";

/** One step of the lifecycle: done with a date and who, or still to come. */
interface Step {
  key: string;
  label: string;
  date: string | null;
  by: string | null;
}

/** The confirmed payment that brought payments up to the deposit, if the quote asked for one. */
function depositPayment(invoice: Invoice, payments: readonly Payment[]): Payment | undefined {
  const confirmed = payments
    .filter((p) => p.status === "confirmed")
    .sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
  const marked = confirmed.find((p) => p.kind === "deposit");
  if (marked) return marked;
  const deposit = dec(depositAmount(invoice.total, invoice.depositPct));
  let running = dec(0);
  return confirmed.find((p) => (running = running.plus(p.amount)).gte(deposit));
}

/**
 * The steps an invoice goes through (spec B2): Created → Sent → Deposit → Installation scheduled →
 * Installed → Paid, each from the records with its date and who did it. Deposit appears when the
 * quote asked for one; the installation steps when the company installs.
 */
export function timelineSteps(
  invoice: Invoice,
  ledger: InvoiceLedger,
  payments: readonly Payment[],
  job: Job | undefined,
  users: readonly User[],
  installs: boolean,
): Step[] {
  const name = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
  const deposit = dec(invoice.depositPct).gt(0) ? depositPayment(invoice, payments) : undefined;
  const settledBy = payments
    .filter((p) => p.status === "confirmed")
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1)?.recordedBy;
  const steps: Step[] = [
    { key: "created", label: "Created", date: invoice.issuedAt, by: name(invoice.createdBy) },
    { key: "sent", label: "Sent", date: invoice.sentAt, by: name(invoice.sentBy) },
  ];
  if (dec(invoice.depositPct).gt(0)) {
    steps.push({ key: "deposit", label: "Deposit", date: deposit?.date ?? null, by: deposit?.recordedBy ?? null });
  }
  if (installs) {
    steps.push(
      { key: "scheduled", label: "Installation scheduled", date: job?.date ?? null, by: null },
      { key: "installed", label: "Installed", date: job?.signedOffAt?.slice(0, 10) ?? null, by: job?.signedBy ?? null },
    );
  }
  steps.push({
    key: "paid",
    label: "Paid",
    date: ledger.state === "paid" || ledger.state === "overpaid" ? ledger.paidAt : null,
    by: ledger.paidAt ? (settledBy ?? null) : null,
  });
  return steps;
}

/** The lifecycle timeline on the invoice page: a step is marked done by its icon and its date, never by colour alone. */
export function InvoiceTimeline({ steps }: { steps: Step[] }) {
  const formatDate = useFormatDate();
  return (
    <Panel title="Timeline">
      <ol className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {steps.map((step) => {
          const done = !!step.date;
          const Icon = done ? Check : Circle;
          return (
            <li key={step.key} className="flex items-start gap-2">
              <span
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
                  done ? "border-success text-success-ink" : "border-hairline text-muted-foreground",
                )}
              >
                <Icon aria-hidden="true" className="size-3" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className={cn("text-sm", done ? "font-medium" : "text-muted-foreground")}>{step.label}</span>
                <span className="text-muted-foreground text-xs">
                  {done ? formatDate(step.date!) : "Not yet"}
                  {done && step.by ? `, ${step.by}` : ""}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
