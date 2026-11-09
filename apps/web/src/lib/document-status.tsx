import {
  CircleCheck,
  CircleDashed,
  CircleDot,
  Clock,
  Coins,
  HandCoins,
  ScanSearch,
  FileText,
  Hourglass,
  Receipt,
  Send,
  TriangleAlert,
  Undo2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import {
  INVOICE_STATUS_LABELS,
  invoiceStatus,
  QUOTE_STATE_LABELS,
  type InvoiceLedger,
  type InvoiceStatusKey,
  type QuoteState,
} from "@workspace/shared";
import { StatusPill, type StatusTone } from "@workspace/ui/components/status-pill";

type PillSpec = { tone: StatusTone; icon: LucideIcon };

const QUOTE: Record<QuoteState, PillSpec> = {
  draft: { tone: "neutral", icon: CircleDashed },
  pending: { tone: "brand", icon: Send },
  accepted: { tone: "success", icon: CircleCheck },
  converted: { tone: "brand", icon: FileText },
  declined: { tone: "neutral", icon: XCircle },
  expired: { tone: "warning", icon: Hourglass },
};

const INVOICE: Record<InvoiceStatusKey, PillSpec> = {
  paid: { tone: "success", icon: Receipt },
  overpaid: { tone: "success", icon: HandCoins },
  overdue: { tone: "danger", icon: TriangleAlert },
  partial: { tone: "warning", icon: Clock },
  deposit: { tone: "warning", icon: Coins },
  pending: { tone: "warning", icon: ScanSearch },
  open: { tone: "brand", icon: CircleDot },
  void: { tone: "neutral", icon: XCircle },
  return: { tone: "neutral", icon: Undo2 },
};

/** A quote's state as an icon and a word (design brief "Status pills", spec B1). */
export function QuoteStatusPill({ state }: { state: QuoteState }) {
  return <StatusPill {...QUOTE[state]} label={QUOTE_STATE_LABELS[state]} />;
}

/** One invoice status as an icon and a word. */
function InvoiceStatusPill({ status }: { status: InvoiceStatusKey }) {
  return <StatusPill {...INVOICE[status]} label={INVOICE_STATUS_LABELS[status]} />;
}

/**
 * An invoice's status from its ledger (spec Appendix A, B2): the leading status, then the labels
 * that sit beside it, such as Overdue with Partly paid, or Deposit paid.
 */
export function InvoiceStatusPills({ ledger }: { ledger: InvoiceLedger }) {
  const { main, extras } = invoiceStatus(ledger);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <InvoiceStatusPill status={main} />
      {extras.map((key) => (
        <InvoiceStatusPill key={key} status={key} />
      ))}
    </span>
  );
}
