import { Check } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";

/** The wizard's steps in order (spec G1): what, file, columns, check, import. */
export const WIZARD_STEPS = [
  ["kind", "What to import"],
  ["file", "File"],
  ["columns", "Columns"],
  ["check", "Check"],
  ["done", "Import"],
] as const;

/** One step of the import wizard. */
export type WizardStep = (typeof WIZARD_STEPS)[number][0];

/**
 * Where the wizard is: done steps carry a tick, the current one is marked for assistive tech.
 * On phones only the current step's name shows beside the numbers.
 */
export function ImportSteps({ current }: { current: WizardStep }) {
  const at = WIZARD_STEPS.findIndex(([key]) => key === current);
  return (
    <ol aria-label="Import steps" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      {WIZARD_STEPS.map(([key, label], i) => (
        <li
          key={key}
          aria-current={i === at ? "step" : undefined}
          className={cn("flex items-center gap-2", i === at ? "font-medium" : "text-muted-foreground")}
        >
          <span
            aria-hidden="true"
            className={cn(
              "grid size-6 place-items-center rounded-full border text-xs tabular-nums",
              i < at && "border-brand bg-brand text-brand-foreground",
              i === at && "border-brand text-brand-ink",
              i > at && "border-hairline",
            )}
          >
            {i < at ? <Check className="size-3.5" strokeWidth={2.5} /> : i + 1}
          </span>
          <span className={cn(i !== at && "sr-only sm:not-sr-only")}>
            {label}
            {i < at ? <span className="sr-only">, done</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
