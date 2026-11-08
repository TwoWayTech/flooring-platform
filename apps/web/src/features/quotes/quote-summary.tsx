"use client";

import { useState, type ReactNode } from "react";
import { Pencil, Undo2 } from "lucide-react";
import {
  depositAmount,
  dec,
  EXAMPLE_RULE_NOTE,
  SENSITIVE,
  stateName,
  type DocumentTotals,
  type TaxContext,
  type TaxOverride,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Num } from "@workspace/ui/components/num";
import { cn } from "@workspace/ui/lib/utils";
import { useCan } from "@/components/workspace/workspace-context";
import { TaxOverrideDialog } from "./tax-override-dialog";

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
    <div
      className={cn(
        "grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-0.5 py-1.5",
        strong && "text-base font-semibold",
      )}
    >
      <dt>{label}</dt>
      <dd className="text-right">{children}</dd>
      {note ? <dd className="text-muted-foreground col-span-2 text-xs font-normal">{note}</dd> : null}
    </div>
  );
}

/**
 * How tax applies at this job site, in plain words: where the rate came from (spec A5), then
 * whether installation labor is taxed there.
 */
function taxNote(ctx: TaxContext, state: string): string {
  if (ctx.exempt) return "Customer holds a valid resale certificate.";
  const source = ctx.source ? `${ctx.source.label}. ` : "";
  if (!ctx.rule) return `${source}No sales tax rule for ${stateName(state)} in your tax settings.`;
  const labor = ctx.rule.taxable.labor || (ctx.lumpSum && ctx.rule.lumpSumLaborTaxable);
  return `${source}Installation labor is ${labor ? "taxed" : "not taxed"} in ${stateName(state)}. ${EXAMPLE_RULE_NOTE}.`;
}

interface QuoteSummaryProps {
  totals: DocumentTotals;
  ctx: TaxContext;
  state: string;
  depositPct: string;
  editable: boolean;
  /** A rate changed on this document, if any (spec A5). */
  override: TaxOverride | null;
  /** True for people with sales.tax.override on an editable document. */
  canOverride: boolean;
  onOverride: (override: TaxOverride | null) => void;
  onDeposit: (pct: string) => void;
  actions: ReactNode;
}

/**
 * The quote summary (design brief wireframe): materials, labor, tax for the job-site state,
 * deposit and total, all from the shared calculator. Cost and margin need view_sensitive.
 */
export function QuoteSummary({
  totals,
  ctx,
  state,
  depositPct,
  editable,
  override,
  canOverride,
  onOverride,
  onDeposit,
  actions,
}: QuoteSummaryProps) {
  const can = useCan();
  const [changingTax, setChangingTax] = useState(false);
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
          note={
            <>
              {taxNote(ctx, state)}
              {canOverride ? (
                <span className="mt-1 flex flex-wrap gap-2">
                  <Button
                    variant="link"
                    size="sm"
                    className="text-brand-ink h-auto px-0 text-xs"
                    onClick={() => setChangingTax(true)}
                  >
                    <Pencil />
                    Change tax
                  </Button>
                  {override ? (
                    <Button
                      variant="link"
                      size="sm"
                      className="text-brand-ink h-auto px-0 text-xs"
                      onClick={() => onOverride(null)}
                    >
                      <Undo2 />
                      Use the default rate
                    </Button>
                  ) : null}
                </span>
              ) : null}
            </>
          }
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
      {changingTax ? (
        <TaxOverrideDialog
          open
          currentRatePct={ctx.rule?.ratePct ?? "0"}
          onOpenChange={setChangingTax}
          onConfirm={onOverride}
        />
      ) : null}
    </div>
  );
}
