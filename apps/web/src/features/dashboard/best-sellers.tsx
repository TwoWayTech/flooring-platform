"use client";

import { useState } from "react";
import { BarChart3, Table2 } from "lucide-react";
import {
  addDays,
  bestSellersIn,
  seesMargin,
  type Product,
  type ProductCategory,
  type SellerMetric,
  type SellerRow,
  type ViewedInvoice,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Num } from "@workspace/ui/components/num";
import { Panel } from "@workspace/ui/components/panel";
import { Segmented } from "@workspace/ui/components/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { Swatch } from "@workspace/ui/components/swatch";
import { useCan } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { CATEGORY_LABELS } from "@workspace/shared";

const WINDOWS = { "7": "7 days", "30": "30 days", "90": "90 days", "365": "12 months", custom: "Custom" } as const;
type Window = keyof typeof WINDOWS;

/**
 * Best sellers (spec E1): its own period (7, 30, 90 days, 12 months or custom), ranked by revenue,
 * quantity or margin, one category or all, as bars with the value beside each or as a table. Follows
 * the dashboard's warehouse filter. Margin needs both keys and a known cost (`seesMargin`; every row's
 * margin is known or none is): without them the Margin option and column are left out and the
 * ranking is by revenue (CLAUDE.md rule 5; ADR 0037, 2026-11-17).
 */
export function BestSellers({
  invoices,
  products,
  locationId,
}: {
  invoices: readonly ViewedInvoice[];
  products: Product[];
  locationId: string | null;
}) {
  const can = useCan();
  const today = api.today();
  const [window, setWindow] = useState<Window>("90");
  const [custom, setCustom] = useState({ from: addDays(today, -29), to: today });
  const [metric, setMetric] = useState<SellerMetric>("revenue");
  const [category, setCategory] = useState("all");
  const [asTable, setAsTable] = useState(false);
  const range = window === "custom" ? custom : { from: addDays(today, -Number(window) + 1), to: today };
  const allowed = seesMargin(can);
  // Without margin sight the ranking is by revenue too, so the bars' order always matches what they show.
  const rows = bestSellersIn(invoices, products, {
    ...range,
    metric: metric === "margin" && !allowed ? "revenue" : metric,
    category: category === "all" ? null : category,
    locationId,
    limit: 5,
  });
  const marginShown = allowed && rows.every((r) => r.margin !== null);
  const shownMetric: SellerMetric = metric === "margin" && !marginShown ? "revenue" : metric;
  const metrics: (readonly [SellerMetric, string])[] = [
    ["revenue", "Revenue"],
    ["quantity", "Quantity"],
    ...(marginShown ? [["margin", "Margin"] as const] : []),
  ];
  return (
    <Panel
      title="Best sellers"
      actions={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAsTable((v) => !v)}
          aria-pressed={asTable}
          aria-label={asTable ? "Show best sellers as a chart" : "Show best sellers as a table"}
        >
          {asTable ? <BarChart3 /> : <Table2 />}
          {asTable ? "Chart" : "Table"}
        </Button>
      }
      bodyClassName="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Select value={window} onValueChange={(v) => setWindow(v as Window)}>
          <SelectTrigger className="h-8 w-32" aria-label="Best sellers period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(WINDOWS) as Window[]).map((w) => (
              <SelectItem key={w} value={w}>
                {WINDOWS[w]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-8 w-40" aria-label="Best sellers category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {(Object.keys(CATEGORY_LABELS) as ProductCategory[])
              .filter((c) => c !== "service")
              .map((c) => (
                <SelectItem key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Segmented
          size="sm"
          label="Rank by"
          value={shownMetric}
          options={metrics}
          onChange={(v) => setMetric(v as SellerMetric)}
        />
      </div>
      {window === "custom" ? (
        <div className="flex flex-wrap gap-2">
          <Input
            type="date"
            aria-label="Best sellers from"
            value={custom.from}
            max={custom.to}
            onChange={(e) => setCustom({ ...custom, from: e.target.value })}
            className="h-8 w-40"
          />
          <Input
            type="date"
            aria-label="Best sellers to"
            value={custom.to}
            min={custom.from}
            max={today}
            onChange={(e) => setCustom({ ...custom, to: e.target.value })}
            className="h-8 w-40"
          />
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No sales in this period.</p>
      ) : asTable ? (
        <BestSellerTable rows={rows} products={products} marginShown={marginShown} />
      ) : (
        <BestSellerBars rows={rows} products={products} metric={shownMetric} />
      )}
    </Panel>
  );
}

/** A product's colour swatch and name: the catalog's when it holds the product, else the row's own name. */
function ProductName({ row, products }: { row: SellerRow; products: readonly Product[] }) {
  const product = products.find((p) => p.id === row.productId);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      {product ? <Swatch color={product.swatch} label={product.colorName} /> : null}
      <span className="min-w-0 truncate">{product?.name ?? row.name}</span>
    </span>
  );
}

/**
 * Best sellers as a table: product, revenue, quantity, and margin when `marginShown`. Every row
 * names its product (click-through #1, 2026-11-21).
 */
export function BestSellerTable({
  rows,
  products,
  marginShown,
}: {
  rows: readonly SellerRow[];
  products: readonly Product[];
  marginShown: boolean;
}) {
  return (
    <table className="w-full text-sm">
      <thead className="text-muted-foreground text-xs">
        <tr>
          <th scope="col" className="py-1 text-left font-medium">
            Product
          </th>
          <th scope="col" className="py-1 text-right font-medium">
            Revenue
          </th>
          <th scope="col" className="py-1 text-right font-medium">
            Quantity
          </th>
          {marginShown ? (
            <th scope="col" className="py-1 text-right font-medium">
              Margin
            </th>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.productId} className="border-hairline border-t">
            <td className="py-1.5">
              <ProductName row={r} products={products} />
            </td>
            <td className="py-1.5 text-right">
              <Num kind="money" value={r.revenue} />
            </td>
            <td className="py-1.5 text-right">
              <Num kind="quantity" value={r.quantity} />
            </td>
            {marginShown && r.margin !== null ? (
              <td className="py-1.5 text-right">
                <Num kind="money" value={r.margin} />
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Best sellers as bars: each product's swatch and name, its value by `metric`, and a bar scaled to
 * the largest value. Every row names its product (click-through #1, 2026-11-21).
 */
export function BestSellerBars({
  rows,
  products,
  metric,
}: {
  rows: readonly SellerRow[];
  products: readonly Product[];
  metric: SellerMetric;
}) {
  const top = Math.max(
    ...rows.flatMap((r) => {
      const value = r[metric];
      return value === null ? [] : [Math.abs(Number(value))];
    }),
    1,
  );
  const kind = metric === "quantity" ? "quantity" : "money";
  return (
    <ol className="flex flex-col gap-3">
      {rows.map((r) => {
        // A shown value is never null (margin shows only when every row has one); this narrows the type.
        const value = r[metric];
        if (value === null) return null;
        return (
          <li key={r.productId} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-sm">
              <ProductName row={r} products={products} />
              <Num kind={kind} value={value} className="font-medium" />
            </div>
            <span className="bg-raised h-1.5 overflow-hidden rounded-full" aria-hidden="true">
              <span
                className="bg-chart-1 block h-full rounded-full"
                style={{ width: `${(Math.abs(Number(value)) / top) * 100}%` }}
              />
            </span>
          </li>
        );
      })}
    </ol>
  );
}
