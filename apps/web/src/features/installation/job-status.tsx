import { CalendarClock, CircleCheck, Hammer, PenLine } from "lucide-react";
import type { JobStatus } from "@workspace/shared";
import { StatusPill } from "@workspace/ui/components/status-pill";

const JOB = {
  scheduled: { tone: "neutral", icon: CalendarClock, label: "Scheduled" },
  in_progress: { tone: "brand", icon: Hammer, label: "In progress" },
  completed: { tone: "warning", icon: PenLine, label: "Awaiting sign-off" },
  signed_off: { tone: "success", icon: CircleCheck, label: "Signed off" },
} as const;

/** A job's status as an icon and a word. */
export function JobStatusPill({ status }: { status: JobStatus }) {
  return <StatusPill {...JOB[status]} />;
}

/** "8 am" style label for a whole hour. */
export function hourLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${hour < 12 ? "am" : "pm"}`;
}
