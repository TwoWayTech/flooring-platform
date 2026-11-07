"use client";

import type { ReactNode } from "react";
import {
  depositAmount,
  dec,
  EXAMPLE_RULE_NOTE,
  SENSITIVE,
  stateName,
  type DocumentTotals,
  type TaxContext,
} from "@workspace/shared";
import { Input } from "@workspace/ui/components/input";
import { Num } from "@workspace/ui/components/num";
import { cn } from "@workspace/ui/lib/utils";
import { useCan } from "@/components/workspace/workspace-context";

function Row({
  label,
  children,
  strong,
  note,
}: {
  label: ReactNode;
  children: ReactNode;
  strong?: boolean;
  note?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5">
      <div className={cn("flex items-baseline justify-between gap-3", strong && "text-base font-semibold")}>
        <dt>{label}</dt>
        <dd className="text-right">{children}</dd>
      </div>
      {note ? <p className="text-muted-foreground text-xs">{note}</p> : null}
    </div>
  );
}

/** How tax applies at this job site, in plain words, for the summary. */
function taxNote(ctx: TaxContext, state: string): string {
  if (ctx.exempt) return "Customer holds a valid resale certificate.";
  if (!ctx.rule) return `No sales tax rule for ${stateName(state)} in your tax settings.`;
  const labor = ctx.rule.taxable.labor || (ctx.lumpSum && ctx.rule.lumpSumLaborTaxable);
  return `Installation labor is ${labor ? "taxed" : "not taxed"} in ${stateName(state)}. ${EXAMPLE_RULE_NOTE}.`;
}

interface QuoteSummaryProps {
  totals: DocumentTotals;
  ctx: TaxContext;
  state: string;
  depositPct: string;
  editable: boolean;
  onDeposit: (pct: string) => void;
  actions: ReactNode;
}

/**
 * The quote summary (design brief wireframe): materials, labor, tax for the job-site state,
 * deposit and total, all from the shared calculator. Cost and margin need view_sensitive.
 */
export function QuoteSummary({ totals, ctx, state, depositPct, editable, onDeposit, actions }: QuoteSummaryProps) {
  const can = useCan();
  const deposit = depositAmount(totals.total, depositPct || "0");
  return (
    <div className="flex flex-col gap-4">
      <dl className="divide-hairline divide-y text-sm">
        <Row label="Materials">
          <Num kind="money" value={totals.materials} />
        </Row>
        <Row label="Labor">
          <Num kind="money" value={totals.labor} />
        </Row>
        {dec(totals.other).gt(0) ? (
          <Row label="Delivery and services">
            <Num kind="money" value={totals.other} />
          </Row>
        ) : null}
        <Row
          label={
            <>
              Tax
              {ctx.rule && !ctx.exempt ? (
                <>
                  , {state} <Num kind="taxRate" value={ctx.rule.ratePct} />
                </>
              ) : null}
            </>
          }
          note={taxNote(ctx, state)}
        >
          <Num kind="money" value={totals.tax} />
        </Row>
        <Row label="Total" strong>
          <span className="font-display text-xl">
            <Num kind="money" value={totals.total} />
          </span>
        </Row>
        <Row
          label={
            <span className="inline-flex items-center gap-2">
              Deposit
              {editable ? (
                <span className="inline-flex items-center gap-1">
                  <Input
                    aria-label="Deposit percent"
                    inputMode="decimal"
                    defaultValue={depositPct}
                    key={depositPct}
                    onBlur={(e) => onDeposit(e.target.value.replace(/[^\d.]/g, "") || "0")}
                    className="h-7 w-14 text-right tabular-nums"
                  />
                  <span className="text-muted-foreground text-xs">%</span>
                </span>
              ) : (
                <Num kind="percent" value={depositPct} />
              )}
            </span>
          }
        >
          <Num kind="money" value={deposit} />
        </Row>
        <Row label="Balance on completion">
          <Num kind="money" value={dec(totals.total).minus(deposit).toString()} />
        </Row>
        {can(SENSITIVE.margin) ? (
          <Row
            label="Margin"
            note={
              <>
                Cost <Num kind="money" value={totals.cost} />
              </>
            }
          >
            <Num kind="money" value={totals.margin} /> (<Num kind="percent" value={totals.marginPct} />)
          </Row>
        ) : null}
      </dl>
      <div className="flex flex-col gap-2">{actions}</div>
    </div>
  );
}
