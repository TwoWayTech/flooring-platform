"use client";

import { STOCK_UNIT_LABELS } from "@workspace/shared";
import { Num } from "@workspace/ui/components/num";
import { Panel } from "@workspace/ui/components/panel";
import { Swatch } from "@workspace/ui/components/swatch";
import type { DashboardData } from "./use-dashboard-data";

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
                <Num
                  kind={row.onHandUnit === "each" ? "count" : "quantity"}
                  value={row.onHand}
                  unit={STOCK_UNIT_LABELS[row.onHandUnit]}
                />{" "}
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
