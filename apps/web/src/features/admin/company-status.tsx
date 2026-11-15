import { Ban, CircleCheck, Clock, CreditCard, Eye, Lock, LockOpen, PauseCircle } from "lucide-react";
import type { CompanyPhase, LifecycleStatus } from "@workspace/shared";
import { StatusPill } from "@workspace/ui/components/status-pill";

/** A company status as the console shows it: the five stored statuses, Cancelled included. */
export const STATUS = {
  active: { tone: "success", icon: CircleCheck, label: "Active" },
  trial: { tone: "brand", icon: Clock, label: "Trial" },
  past_due: { tone: "warning", icon: CreditCard, label: "Past due" },
  suspended: { tone: "neutral", icon: PauseCircle, label: "Suspended" },
  cancelled: { tone: "danger", icon: Ban, label: "Cancelled" },
} as const satisfies Record<LifecycleStatus, unknown>;

/**
 * What a company may do now (blueprint p29; ADR 0033). Full use is the quiet default; only a
 * read-only or locked company draws the eye.
 */
export const PHASE = {
  full: { tone: "neutral", icon: LockOpen, label: "Full use" },
  read_only: { tone: "warning", icon: Eye, label: "Read-only" },
  locked: { tone: "danger", icon: Lock, label: "Locked" },
} as const satisfies Record<CompanyPhase, unknown>;

/** A company's stored status as an icon and a word. */
export function CompanyStatusPill({ status }: { status: LifecycleStatus }) {
  return <StatusPill {...STATUS[status]} />;
}

/** A company's life-cycle phase as an icon and a word. */
export function CompanyPhasePill({ phase }: { phase: CompanyPhase }) {
  return <StatusPill {...PHASE[phase]} />;
}
