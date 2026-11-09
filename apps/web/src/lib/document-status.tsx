import {
  CircleCheck,
  CircleDashed,
  CircleDot,
  Clock,
  FileText,
  Hourglass,
  Receipt,
  Send,
  TriangleAlert,
  Undo2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { balance, isOverdue, QUOTE_STATE_LABELS, type Invoice, type QuoteState } from "@workspace/shared";
import { StatusPill, type StatusTone } from "@workspace/ui/components/status-pill";

type PillSpec = { tone: StatusTone; icon: LucideIcon; label: string };

const QUOTE: Record<QuoteState, Omit<PillSpec, "label">> = {
  draft: { tone: "neutral", icon: CircleDashed },
  pending: { tone: "brand", icon: Send },
  accepted: { tone: "success", icon: CircleCheck },
  converted: { tone: "brand", icon: FileText },
  declined: { tone: "neutral", icon: XCircle },
  expired: { tone: "warning", icon: Hourglass },
};

/** What an invoice's state is today, for its pill and for filters. */
export type InvoiceState = "paid" | "overdue" | "partial" | "open" | "void" | "return";

const INVOICE: Record<InvoiceState, PillSpec> = {
  paid: { tone: "success", icon: Receipt, label: "Paid" },
  overdue: { tone: "danger", icon: TriangleAlert, label: "Overdue" },
  partial: { tone: "warning", icon: Clock, label: "Partly paid" },
  open: { tone: "brand", icon: CircleDot, label: "Open" },
  void: { tone: "neutral", icon: XCircle, label: "Void" },
  return: { tone: "neutral", icon: Undo2, label: "Return" },
};

/** An invoice's state: overdue is derived from the due date and balance (spec "Customers and receivables"). */
export function invoiceState(invoice: Invoice, today: string): InvoiceState {
  if (invoice.isReturn) return "return";
  if (invoice.status === "void") return "void";
  if (isOverdue(invoice, today)) return "overdue";
  if (balance(invoice).lte(0)) return "paid";
  return invoice.status === "partial" ? "partial" : "open";
}

/** Label of an invoice state, for filters and CSV. */
export function invoiceStateLabel(state: InvoiceState): string {
  return INVOICE[state].label;
}

/** A quote's state as an icon and a word (design brief "Status pills", spec B1). */
export function QuoteStatusPill({ state }: { state: QuoteState }) {
  return <StatusPill {...QUOTE[state]} label={QUOTE_STATE_LABELS[state]} />;
}

/** An invoice's state as an icon and a word. */
export function InvoiceStatePill({ state }: { state: InvoiceState }) {
  return <StatusPill {...INVOICE[state]} />;
}
