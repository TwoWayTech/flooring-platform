import { Ban, CircleCheck, CircleDashed, Clock, FileCheck2, Send, TriangleAlert } from "lucide-react";
import { CONTRACT_STATUS_LABELS, type ContractStatus } from "@workspace/shared";

/** How each contract status reads as a pill (spec D2). */
export const CONTRACT_STATUS = {
  draft: { tone: "neutral", icon: CircleDashed, label: CONTRACT_STATUS_LABELS.draft },
  sent: { tone: "brand", icon: Send, label: CONTRACT_STATUS_LABELS.sent },
  active: { tone: "success", icon: CircleCheck, label: CONTRACT_STATUS_LABELS.active },
  completed: { tone: "brand", icon: Clock, label: CONTRACT_STATUS_LABELS.completed },
  closed: { tone: "neutral", icon: FileCheck2, label: CONTRACT_STATUS_LABELS.closed },
  terminated: { tone: "danger", icon: Ban, label: CONTRACT_STATUS_LABELS.terminated },
  expired: { tone: "warning", icon: TriangleAlert, label: CONTRACT_STATUS_LABELS.expired },
} as const satisfies Record<ContractStatus | "expired", unknown>;
