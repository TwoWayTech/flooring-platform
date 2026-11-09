"use client";

import { Info } from "lucide-react";
import { dec, receivablesSummary, type Invoice, type InvoiceLedger } from "@workspace/shared";
import { Num } from "@workspace/ui/components/num";
import { Panel } from "@workspace/ui/components/panel";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { api } from "@/lib/api";

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
 * Receivables in two clear figures (spec B5): Current (not yet due) and Overdue (past the due
 * date), plus what falls due in the next 7 days. The detailed aging lives in Reports.
 */
export function ReceivablesSummary({
  invoices,
  ledgers,
}: {
  invoices: readonly Invoice[];
  ledgers: ReadonlyMap<string, InvoiceLedger>;
}) {
  const summary = receivablesSummary(invoices, ledgers, api.today());
  const share = dec(summary.total).isZero() ? "0" : dec(summary.overdue).div(summary.total).times(100).toString();
  return (
    <Panel
      title="Receivables"
      actions={
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground rounded p-1"
              aria-label="How receivables are calculated"
            >
              <Info aria-hidden="true" className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Calculated from each invoice&apos;s due date.</TooltipContent>
        </Tooltip>
      }
    >
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Figure label="Current" value={summary.current} note="Not yet due" />
        <Figure
          label="Overdue"
          value={summary.overdue}
          note={
            <>
              <Num kind="percent" value={share} /> of <Num kind="money" value={summary.total} /> open
            </>
          }
        />
        <Figure label="Due in the next 7 days" value={summary.dueSoon} />
      </dl>
    </Panel>
  );
}
