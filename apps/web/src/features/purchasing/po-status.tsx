import { CircleCheck, CircleDashed, PackageCheck, Send } from "lucide-react";
import type { PoStatus } from "@workspace/shared";
import { StatusPill } from "@workspace/ui/components/status-pill";

const PO = {
  draft: { tone: "neutral", icon: CircleDashed, label: "Draft" },
  sent: { tone: "brand", icon: Send, label: "Ordered" },
  received: { tone: "warning", icon: PackageCheck, label: "Received, not billed" },
  billed: { tone: "success", icon: CircleCheck, label: "Billed" },
} as const;

/** Label of a purchase order status, for filters and CSV. */
export function poStatusLabel(status: PoStatus): string {
  return PO[status].label;
}

/** A purchase order's status as an icon and a word. */
export function PoStatusPill({ status }: { status: PoStatus }) {
  return <StatusPill {...PO[status]} />;
}
