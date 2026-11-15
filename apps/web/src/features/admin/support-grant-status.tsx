import { Ban, CircleCheck, Clock, TimerOff } from "lucide-react";
import type { SupportGrantStatus } from "@workspace/shared";
import { StatusPill } from "@workspace/ui/components/status-pill";

/**
 * A support request's status as the console shows it (docs/specs/platform-admin.md, part 3,
 * "Support tab"): waiting for the Owner draws the eye, approved is a success, and the two closed
 * states are quiet.
 */
export const SUPPORT_STATUS = {
  pending: { tone: "warning", icon: Clock, label: "Pending" },
  approved: { tone: "success", icon: CircleCheck, label: "Approved" },
  revoked: { tone: "neutral", icon: Ban, label: "Revoked" },
  expired: { tone: "neutral", icon: TimerOff, label: "Expired" },
} as const satisfies Record<SupportGrantStatus, unknown>;

/** A support request's derived status as an icon and a word. */
export function SupportGrantStatusPill({ status }: { status: SupportGrantStatus }) {
  return <StatusPill {...SUPPORT_STATUS[status]} />;
}
