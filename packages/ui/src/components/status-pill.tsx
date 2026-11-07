import type { LucideIcon } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";

/** Tones a status can take; each pairs a tint with an ink that passes AA. */
export type StatusTone = "neutral" | "brand" | "success" | "warning" | "danger";

const TONES: Record<StatusTone, string> = {
  neutral: "bg-raised text-muted-foreground",
  brand: "bg-brand-soft text-brand-ink",
  success: "bg-success/12 text-success-ink",
  warning: "bg-warning/14 text-warning-ink",
  danger: "bg-danger/12 text-danger-ink",
};

interface StatusPillProps {
  tone: StatusTone;
  icon: LucideIcon;
  label: string;
  className?: string;
}

/** A status as an icon and a word, never color alone (design brief "States"). */
export function StatusPill({ tone, icon: Icon, label, className }: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" strokeWidth={2.25} />
      {label}
    </span>
  );
}
