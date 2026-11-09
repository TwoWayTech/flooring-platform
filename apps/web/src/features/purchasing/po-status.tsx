import { Ban, CircleCheck, CircleDashed, Clock, PackageCheck, PackageOpen, ReceiptText, Send } from "lucide-react";
import { PO_STATE_LABELS, type PoState } from "@workspace/shared";
import { StatusPill, type StatusTone } from "@workspace/ui/components/status-pill";
import type { LucideIcon } from "lucide-react";

const PO: Record<PoState, { tone: StatusTone; icon: LucideIcon }> = {
  draft: { tone: "neutral", icon: CircleDashed },
  ordered: { tone: "brand", icon: Send },
  partly_received: { tone: "warning", icon: PackageOpen },
  received: { tone: "warning", icon: PackageCheck },
  billed: { tone: "brand", icon: ReceiptText },
  partly_paid: { tone: "warning", icon: Clock },
  paid: { tone: "success", icon: CircleCheck },
  cancelled: { tone: "neutral", icon: Ban },
};

/** A purchase order's derived status as an icon and a word (spec D1). */
export function PoStatusPill({ state }: { state: PoState }) {
  return <StatusPill {...PO[state]} label={PO_STATE_LABELS[state]} />;
}
