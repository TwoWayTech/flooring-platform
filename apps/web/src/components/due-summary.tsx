"use client";

import { Info } from "lucide-react";
import { dec } from "@workspace/shared";
import { Num } from "@workspace/ui/components/num";
import { Panel } from "@workspace/ui/components/panel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";

/** One figure: a label over the amount, with an optional note under it. */
function Figure({ label, value, note }: { label: string; value: string; note?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-display text-2xl font-semibold">
        <Num kind="money" value={value} />
      </dd>
      {note ? <dd className="text-muted-foreground text-xs">{note}</dd> : null}
    </div>
  );
}

/**
 * Money owed in two clear figures (spec B5, D3): Current (not yet due) and Overdue (past the due
 * date, with its share of the total), plus what falls due in the next 7 days. Used for
 * receivables and payables; the detailed aging lives in Reports.
 */
export function DueSummary({
  title,
  current,
  overdue,
  total,
  dueSoon,
  basis,
}: {
  title: string;
  /** The documents the figures come from, for the info tooltip, e.g. "invoice". */
  basis: string;
  current: string;
  overdue: string;
  total: string;
  dueSoon: string;
}) {
  const share = dec(total).isZero() ? "0" : dec(overdue).div(total).times(100).toString();
  return (
    <Panel
      title={title}
      actions={
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground rounded p-1"
              aria-label={`How ${title.toLowerCase()} are calculated`}
            >
              <Info aria-hidden="true" className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Calculated from each {basis}&apos;s due date.</TooltipContent>
        </Tooltip>
      }
    >
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Figure label="Current" value={current} note="Not yet due" />
        <Figure
          label="Overdue"
          value={overdue}
          note={
            <>
              <Num kind="percent" value={share} /> of <Num kind="money" value={total} /> open
            </>
          }
        />
        <Figure label="Due in the next 7 days" value={dueSoon} />
      </dl>
    </Panel>
  );
}
