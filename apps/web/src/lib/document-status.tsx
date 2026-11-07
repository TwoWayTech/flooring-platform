import {
  CircleCheck,
  CircleDashed,
  CircleDot,
  Clock,
  FileText,
  Receipt,
  Send,
  TriangleAlert,
  Undo2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { balance, isOverdue, type Invoice, type QuoteStatus } from "@workspace/shared";
import { StatusPill, type StatusTone } from "@workspace/ui/components/status-pill";

type PillSpec = { tone: StatusTone; icon: LucideIcon; label: string };

const QUOTE: Record<QuoteStatus, PillSpec> = {
  draft: { tone: "neutral", icon: CircleDashed, label: "Draft" },
  sent: { tone: "brand", icon: Send, label: "Sent" },
  accepted: { tone: "success", icon: CircleCheck, label: "Accepted" },
  invoiced: { tone: "brand", icon: FileText, label: "Invoiced" },
  declined: { tone: "neutral", icon: XCircle, label: "Declined" },
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

/** A quote's status as an icon and a word (design brief "Status pills"). */
export function QuoteStatusPill({ status }: { status: QuoteStatus }) {
  return <StatusPill {...QUOTE[status]} />;
}

/** An invoice's state as an icon and a word. */
export function InvoiceStatePill({ state }: { state: InvoiceState }) {
  return <StatusPill {...INVOICE[state]} />;
}

/** Label of a quote status, for filters and CSV. */
export function quoteStatusLabel(status: QuoteStatus): string {
  return QUOTE[status].label;
}
