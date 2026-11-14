import { TriangleAlert } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";

/**
 * The California pay rules note (ADR 0050): pending payroll review while `hr.payroll.california`
 * is on, or off with California staff. Renders nothing when there is no note, so screens pass
 * `californiaPayNote(...)` straight in.
 */
export function CaliforniaPayNote({ note, className }: { note: string | null; className?: string }) {
  if (!note) return null;
  return (
    <p
      role="note"
      data-testid="california-pay-note"
      className={cn("text-warning-ink bg-warning/14 flex gap-2 rounded-md p-3 text-sm", className)}
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {note}
    </p>
  );
}
