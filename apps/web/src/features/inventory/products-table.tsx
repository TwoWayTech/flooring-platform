"use client";

import { useState } from "react";
import {
  SENSITIVE,
  UNIT_SINGULAR,
  type Location,
  STOCK_UNIT_LABELS,
  type Product,
  type Reservation,
  type Roll,
  type StockMovement,
} from "@workspace/shared";
import { Num } from "@workspace/ui/components/num";
import { CartonHint } from "@/components/quantity/carton-hint";
import { Swatch } from "@workspace/ui/components/swatch";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { useCan } from "@/components/workspace/workspace-context";
import { CATEGORY_LABELS } from "@workspace/shared";
import { ProductDrawer } from "./product-drawer";
import { stockLevel, type StockLevel } from "./stock";
import { StockBadge } from "./stock-badge";

interface ProductsTableProps {
  products: Product[];
  rolls: Roll[];
  movements: StockMovement[];
  reservations: Reservation[];
  locations: Location[];
  /** Stock is shown at this warehouse, or across all when null (spec A1 warehouse filter). */
  warehouseId: string | null;
}

/**
 * The product list with On hand, Reserved and Available at the chosen warehouse and the stock
 * status (spec C2, C3); a row opens the product drawer. Cost needs view_sensitive.
 */
export function ProductsTable({
  products,
  rolls,
  movements,
  reservations,
  locations,
  warehouseId,
}: ProductsTableProps) {
  const can = useCan();
  const [open, setOpen] = useState<Product | null>(null);
  const levels = new Map(
    products.map((p) => [p.id, stockLevel(p, { rolls, movements, reservations }, warehouseId)] as const),
  );
  const level = (p: Product) => levels.get(p.id)!;
  const amount = (p: Product, key: keyof Pick<StockLevel, "onHand" | "reserved" | "available">) =>
    p.category === "service" ? null : Number(level(p)[key]);
  const shown = (p: Product, key: keyof Pick<StockLevel, "onHand" | "reserved" | "available">) =>
    p.category === "service" ? (
      <span className="text-muted-foreground">Service</span>
    ) : (
      <Num
        kind={level(p).unit === "each" ? "count" : "quantity"}
        value={level(p)[key]}
        unit={STOCK_UNIT_LABELS[level(p).unit]}
      />
    );

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
      header: "On hand",
      kind: "quantity",
      value: (p) => amount(p, "onHand"),
      cell: (p) => (
        <span className="inline-flex items-center gap-2">
          {shown(p, "onHand")}
          {p.category !== "service" && level(p).unit === "ft" ? (
            <span className="text-muted-foreground">on {level(p).rolls} rolls</span>
          ) : null}
          <CartonHint quantity={level(p).onHand} sqFtPerCarton={p.sqFtPerCarton} compact />
        </span>
      ),
    },
    {
      id: "reserved",
      header: "Reserved",
      kind: "quantity",
      value: (p) => amount(p, "reserved"),
      cell: (p) => shown(p, "reserved"),
    },
    {
      id: "available",
      header: "Available",
      kind: "quantity",
      value: (p) => amount(p, "available"),
      cell: (p) => (
        <span className="inline-flex items-center gap-2">
          {p.category !== "service" ? <StockBadge status={level(p).status} /> : null}
          {shown(p, "available")}
        </span>
      ),
    },
    {
      id: "stockStatus",
      header: "Stock status",
      hidden: true,
      value: (p) =>
        p.category === "service" ? null : { out: "Out of stock", low: "Low stock", ok: "In stock" }[level(p).status],
    },
  ];

  return (
    <>
      <DataTable
        id="inventory-products"
        rows={products}
        columns={columns}
        getRowId={(p) => p.id}
        onRowClick={setOpen}
        rowLabel={(p) => `Open ${p.name}`}
        searchPlaceholder="Search products"
        csvName="products"
        empty={{ message: "No products yet." }}
        initialSort={{ id: "name", desc: false }}
      />
      <ProductDrawer
        product={open}
        rolls={rolls}
        movements={movements}
        reservations={reservations}
        locations={locations}
        onClose={() => setOpen(null)}
      />
    </>
  );
}
