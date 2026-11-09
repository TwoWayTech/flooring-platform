"use client";

import { AGING_BUCKETS, agingSummary, type OpenAmount } from "@workspace/shared";
import { Num } from "@workspace/ui/components/num";
import { Panel } from "@workspace/ui/components/panel";
import { cn } from "@workspace/ui/lib/utils";

/** Tone per bucket: the older the debt, the warmer the bar (paired with the bucket's label). */
const TONE: Record<(typeof AGING_BUCKETS)[number]["key"], string> = {
  current: "bg-chart-1",
  d30: "bg-chart-3",
  d60: "bg-warning",
  d90: "bg-warning",
  d90plus: "bg-danger",
};

/**
 * Aging by bucket (spec: current, 30, 60, 90+) for receivables or payables. The buckets always
 * add up to the open balance, which the reconciliation test checks on the fixtures.
 */
export function AgingPanel({ title, docs, today }: { title: string; docs: readonly OpenAmount[]; today: string }) {
  const aging = agingSummary(docs, today);
  const total = Number(aging.total) || 1;
  return (
    <Panel
      title={title}
      actions={
        <span className="text-sm font-semibold">
          <Num kind="money" value={aging.total} /> open
        </span>
      }
    >
      {Number(aging.total) === 0 ? <p className="text-muted-foreground mb-4">Everything is paid in full.</p> : null}
      <div className="flex h-2.5 overflow-hidden rounded-full" aria-hidden="true">
        {AGING_BUCKETS.map((b) => (
          <span
            key={b.key}
            className={cn(TONE[b.key], "h-full border-r-2 border-surface last:border-r-0")}
            style={{ width: `${(Number(aging[b.key]) / total) * 100}%` }}
          />
        ))}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
        {AGING_BUCKETS.map((b) => (
          <div key={b.key} className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <span aria-hidden="true" className={cn("size-2 rounded-xs", TONE[b.key])} />
              {b.label}
            </dt>
            <dd className="text-base font-semibold">
              <Num kind="money" value={aging[b.key]} />
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
