"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import {
  SENSITIVE,
  UNIT_SINGULAR,
  type Location,
  type Product,
  type ProductCategory,
  type Roll,
  type StockMovement,
} from "@workspace/shared";
import { Num } from "@workspace/ui/components/num";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { Swatch } from "@workspace/ui/components/swatch";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { useCan } from "@/components/workspace/workspace-context";
import { CATEGORY_LABELS } from "@/lib/labels";
import { ProductDrawer } from "./product-drawer";
import { stockLevel } from "./stock";

const ALL = "all";

interface ProductsTableProps {
  products: Product[];
  rolls: Roll[];
  movements: StockMovement[];
  locations: Location[];
  /** Stock is shown at this warehouse, or across all when null (spec A1 warehouse filter). */
  warehouseId: string | null;
}

/** The product list with category filter; a row opens the product drawer. Cost needs view_sensitive. */
export function ProductsTable({ products, rolls, movements, locations, warehouseId }: ProductsTableProps) {
  const can = useCan();
  const [category, setCategory] = useState<ProductCategory | typeof ALL>(ALL);
  const [open, setOpen] = useState<Product | null>(null);
  const rows = products.filter((p) => category === ALL || p.category === category);

  const columns: ColumnSpec<Product>[] = [
    {
      id: "name",
      header: "Product",
      value: (p) => p.name,
      cell: (p) => (
        <span className="flex items-center gap-2">
          <Swatch color={p.swatch} label={p.colorName || p.name} />
          <span className="font-medium">{p.name}</span>
          <span className="text-muted-foreground hidden md:inline">{p.brand}</span>
        </span>
      ),
    },
    { id: "sku", header: "SKU", value: (p) => p.sku },
    { id: "category", header: "Category", value: (p) => CATEGORY_LABELS[p.category] },
    {
      id: "price",
      header: "Price",
      kind: "money",
      value: (p) => p.price,
      cell: (p, { delta }) => (
        <>
          <Num kind="money" value={p.price} delta={delta} />
          <span className="text-muted-foreground"> per {UNIT_SINGULAR[p.unit]}</span>
        </>
      ),
    },
    ...(can(SENSITIVE.productCost)
      ? [{ id: "cost", header: "Cost", kind: "unitCost" as const, value: (p: Product) => p.cost }]
      : []),
    {
      id: "stock",
      header: "Stock",
      kind: "quantity",
      value: (p) => (p.category === "service" ? null : Number(stockLevel(p, rolls, movements, warehouseId).value)),
      cell: (p) => {
        if (p.category === "service") return <span className="text-muted-foreground">Service</span>;
        const s = stockLevel(p, rolls, movements, warehouseId);
        return (
          <span className="inline-flex items-center gap-2">
            {s.low ? <StatusPill tone="warning" icon={TriangleAlert} label="Low" /> : null}
            <Num kind={s.unit === "ft" ? "quantity" : "count"} value={s.value} unit={s.unit} />
            {s.unit === "ft" ? <span className="text-muted-foreground">on {s.rolls} rolls</span> : null}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <DataTable
        id="inventory-products"
        rows={rows}
        columns={columns}
        getRowId={(p) => p.id}
        onRowClick={setOpen}
        rowLabel={(p) => `Open ${p.name}`}
        searchPlaceholder="Search products"
        csvName="products"
        empty={{ message: "No products in this category." }}
        initialSort={{ id: "name", desc: false }}
        toolbar={
          <Select value={category} onValueChange={(v) => setCategory(v as ProductCategory | typeof ALL)}>
            <SelectTrigger className="bg-surface h-9 w-52" aria-label="Category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All categories</SelectItem>
              {(Object.keys(CATEGORY_LABELS) as ProductCategory[]).map((c) => (
                <SelectItem key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      <ProductDrawer
        product={open}
        rolls={rolls}
        movements={movements}
        locations={locations}
        onClose={() => setOpen(null)}
      />
    </>
  );
}
