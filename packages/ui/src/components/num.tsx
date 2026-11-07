"use client";

import { formatFull, formatNumber, isRounded, type DecimalInput, type NumberKind } from "@workspace/shared";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { useNumberSettings } from "@workspace/ui/components/number-settings";
import { cn } from "@workspace/ui/lib/utils";

interface NumProps {
  value: DecimalInput;
  kind: NumberKind;
  /** Abbreviate large values (12.4K), for dashboard figures. */
  compact?: boolean;
  /** Per-column "More decimals / Fewer decimals" adjustment. */
  delta?: number;
  /** Unit after the number, e.g. "sq ft". */
  unit?: string;
  className?: string;
}

/**
 * Every number on screen goes through <Num> (CLAUDE.md rule 3): company decimals per kind,
 * tabular figures, and the full stored value on hover whenever the display rounds it.
 */
export function Num({ value, kind, compact = false, delta = 0, unit, className }: NumProps) {
  const settings = useNumberSettings();
  const text = formatNumber(value, kind, settings, { compact, decimalsDelta: delta });
  const shown = unit ? `${text} ${unit}` : text;
  if (!compact && !isRounded(value, kind, settings, delta)) {
    return <span className={cn("tabular-nums", className)}>{shown}</span>;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn("tabular-nums decoration-dotted underline-offset-4 hover:underline", className)}
        >
          {shown}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <span className="tabular-nums">{formatFull(value, kind, settings)}</span>
      </TooltipContent>
    </Tooltip>
  );
}
