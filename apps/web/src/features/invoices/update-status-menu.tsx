"use client";

import { useState } from "react";
import { Ban, ChevronDown, Coins, HandCoins, Receipt, ReceiptText, Send, Eraser, Users } from "lucide-react";
import { toast } from "sonner";
import {
  dec,
  featureOn,
  formatNumber,
  invoiceActions,
  type Invoice,
  type InvoiceAction,
  type InvoiceLedger,
  type PaymentSettings,
  type PermissionKey,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { useNumberSettings } from "@workspace/ui/components/number-settings";
import { ReasonDialog } from "@/components/reason-dialog";
import { useStepUp } from "@/components/use-step-up";
import { useCan } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { CommissionSplitDialog } from "./commission-split-dialog";
import { CreditNoteDialog } from "./credit-note-dialog";

/** Each action's words, icon and the permission it needs (spec B2, Appendix A "Permissions"). */
const ACTIONS: Record<InvoiceAction, { label: string; icon: typeof Coins; permission: PermissionKey }> = {
  deposit: { label: "Record deposit", icon: Coins, permission: "sales.payment.record" },
  payment: { label: "Record payment", icon: Receipt, permission: "sales.payment.record" },
  send: { label: "Mark as sent", icon: Send, permission: "sales.invoice.create" },
  credit: { label: "Apply credit", icon: HandCoins, permission: "sales.payment.apply_credit" },
  write_off: { label: "Write off remaining balance", icon: Eraser, permission: "sales.payment.write_off" },
  void: { label: "Void invoice", icon: Ban, permission: "sales.invoice.void" },
};

interface UpdateStatusMenuProps {
  invoice: Invoice;
  ledger: InvoiceLedger;
  /** The customer's credit now, for Apply credit. */
  credit: string;
  settings: PaymentSettings;
  /** Opens the Record payment drawer, as a deposit or a payment. */
  onRecord: (asDeposit: boolean) => void;
}

/**
 * Update status (spec B2): no free status dropdown, only the valid next actions for the
 * invoice's state that the viewer may take. Each opens its form with the information it needs;
 * the status then follows from the records.
 */
export function UpdateStatusMenu({ invoice, ledger, credit, settings, onRecord }: UpdateStatusMenuProps) {
  const can = useCan();
  const numbers = useNumberSettings();
  const [asking, setAsking] = useState<"write_off" | "void" | "credit_note" | "split" | null>(null);
  const stepUp = useStepUp();
  const money = (v: string) => formatNumber(v, "money", numbers);
  const offered = invoiceActions(invoice, ledger, {
    customerCredit: credit,
    writeOffMax: settings.writeOffMax.trim() || ledger.balance,
  }).filter((a) => can(ACTIONS[a].permission));
  const live = !invoice.voidedAt && !invoice.isReturn;
  const canCredit = live && can("sales.invoice.void");
  const canSplit =
    live &&
    featureOn("hr.commissions") &&
    dec(ledger.paid).isZero() &&
    (can("hr.commission.manage") || can("sales.invoice.edit"));
  if (offered.length === 0 && !canCredit && !canSplit) return null;

  const run = (work: Promise<unknown>, done: string) =>
    work
      .then(() => toast.success(done))
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Not saved. Try again."));

  function choose(action: InvoiceAction) {
    if (action === "deposit" || action === "payment") return onRecord(action === "deposit");
    if (action === "send") return void run(api.markInvoiceSent(invoice.id), `${invoice.number} marked as sent`);
    if (action === "credit") return void run(api.applyCredit(invoice.id), `Credit applied to ${invoice.number}`);
    setAsking(action);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            Update status
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          {offered.map((action) => {
            const { label, icon: Icon } = ACTIONS[action];
            return (
              <DropdownMenuItem key={action} onSelect={() => choose(action)}>
                <Icon />
                {action === "credit" ? `Apply ${money(credit)} credit` : label}
              </DropdownMenuItem>
            );
          })}
          {canSplit ? (
            <DropdownMenuItem onSelect={() => setAsking("split")}>
              <Users />
              Commission split
            </DropdownMenuItem>
          ) : null}
          {canCredit ? (
            <DropdownMenuItem onSelect={() => setAsking("credit_note")}>
              <ReceiptText />
              Issue credit note
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {asking === "write_off" ? (
        <ReasonDialog
          title={`Write off ${money(ledger.balance)}`}
          description="The leftover balance is closed and the invoice reads Paid, with a write-off line on the statement."
          confirmLabel="Write off"
          onConfirm={async (reason) =>
            // Writing off gives up money owed, so the API asks for a fresh code (ADR 0063).
            stepUp.ask(`Writing off ${money(ledger.balance)} on ${invoice.number}`, () =>
              api.writeOffBalance(invoice.id, reason).then(() => {
                toast.success(`${invoice.number} written off`);
              }),
            )
          }
          onClose={() => setAsking(null)}
        />
      ) : null}
      {stepUp.dialog}
      {asking === "credit_note" ? <CreditNoteDialog invoice={invoice} onClose={() => setAsking(null)} /> : null}
      {asking === "split" ? <CommissionSplitDialog invoice={invoice} onClose={() => setAsking(null)} /> : null}
      {asking === "void" ? (
        <ReasonDialog
          title={`Void ${invoice.number}`}
          description="A void invoice owes nothing and stays in the list as Void. Payments waiting for verification are voided with it."
          confirmLabel="Void invoice"
          destructive
          onConfirm={(reason) =>
            api.voidInvoice(invoice.id, reason).then(() => toast.success(`${invoice.number} voided`))
          }
          onClose={() => setAsking(null)}
        />
      ) : null}
    </>
  );
}
