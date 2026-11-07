"use client";

import { Num } from "@workspace/ui/components/num";
import { Panel } from "@workspace/ui/components/panel";
import { Swatch } from "@workspace/ui/components/swatch";
import type { DashboardData } from "./use-dashboard-data";

/** Best sellers by revenue over the last quarter, each with a bar scaled to the top seller. */
export function BestSellers({ rows }: { rows: DashboardData["best"] }) {
  const top = Math.max(...rows.map((r) => Number(r.revenue)), 1);
  return (
    <Panel title="Best sellers, last 90 days">
      {rows.length === 0 ? (
        <p className="text-muted-foreground">No sales in the last 90 days.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.productId} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-sm">
                <Swatch color={row.product.swatch} label={row.product.colorName} />
                <span className="min-w-0 flex-1 truncate">{row.product.name}</span>
                <Num kind="money" value={row.revenue} className="font-medium" />
              </div>
              <span className="bg-raised h-1.5 overflow-hidden rounded-full" aria-hidden="true">
                <span
                  className="bg-chart-1 block h-full rounded-full"
                  style={{ width: `${(Number(row.revenue) / top) * 100}%` }}
                />
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

/** Slow movers: stocked products with the longest time since their last sale. */
export function SlowMovers({ rows }: { rows: DashboardData["slow"] }) {
  return (
    <Panel title="Slow movers">
      <ol className="flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.productId} className="flex items-center gap-2 text-sm">
            <Swatch color={row.product.swatch} label={row.product.colorName} />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{row.product.name}</span>
              <span className="text-muted-foreground block text-xs">
                <Num kind={row.onHandUnit === "ft" ? "quantity" : "count"} value={row.onHand} unit={row.onHandUnit} />{" "}
                in stock
              </span>
            </span>
            <span className="text-right text-xs">
              <span className="text-foreground block text-sm font-medium tabular-nums">
                <Num kind="count" value={row.daysWithoutSale} /> days
              </span>
              <span className="text-muted-foreground">{row.lastSoldAt ? "since last sale" : "in stock, no sales"}</span>
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
