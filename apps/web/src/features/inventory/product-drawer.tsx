"use client";

import Link from "next/link";
import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import {
  SENSITIVE,
  UNIT_SINGULAR,
  isBoxed,
  type Product,
  STOCK_UNIT_LABELS,
  type Reservation,
  type Roll,
  type Location,
  type StockMovement,
  warehousesOf,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import { CartonHint } from "@/components/quantity/carton-hint";
import { RollGauge } from "@workspace/ui/components/roll-gauge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet";
import { Swatch } from "@workspace/ui/components/swatch";
import { useCan } from "@/components/workspace/workspace-context";
import { CATEGORY_LABELS } from "@workspace/shared";
import { AdjustStockDialog } from "./adjust-stock-dialog";
import { stockLevel } from "./stock";
import { StockBadge } from "./stock-badge";

/** Attribute keys as people say them. */
const ATTRIBUTE_LABELS: Record<string, string> = {
  fiber: "Fiber",
  construction: "Construction",
  faceWeightOz: "Face weight (oz)",
  widthFt: "Width (ft)",
  size: "Size",
  wearLayerMil: "Wear layer (mil)",
  thicknessMm: "Thickness (mm)",
  acRating: "AC rating",
  species: "Species",
  widthIn: "Plank width (in)",
  finish: "Finish",
  densityLb: "Density (lb)",
  thicknessIn: "Thickness (in)",
  kind: "Type",
};

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

/**
 * A product's details in a side drawer: price, available and on-hand stock per warehouse with its
 * status (spec C2, C3), attributes, its rolls for broadloom, and Adjust stock for boxed goods (C1).
 */
export function ProductDrawer({
  product,
  rolls,
  movements,
  reservations,
  locations,
  onClose,
}: {
  product: Product | null;
  rolls: Roll[];
  movements: StockMovement[];
  reservations: Reservation[];
  locations: Location[];
  onClose: () => void;
}) {
  const can = useCan();
  const [adjusting, setAdjusting] = useState(false);
  const own = product ? rolls.filter((r) => r.productId === product.id) : [];
  return (
    <Sheet open={!!product} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="bg-surface w-full overflow-y-auto sm:max-w-md">
        {product ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Swatch color={product.swatch} label={product.colorName || product.name} className="size-5" />
                {product.name}
              </SheetTitle>
              <SheetDescription>
                {product.brand}, {CATEGORY_LABELS[product.category]}
              </SheetDescription>
              {isBoxed(product) && can("inventory.stock.adjust") ? (
                <Button variant="outline" size="sm" className="self-start" onClick={() => setAdjusting(true)}>
                  <SlidersHorizontal />
                  Adjust stock
                </Button>
              ) : null}
            </SheetHeader>
            <dl className="divide-hairline divide-y px-4 text-sm">
              <Fact label="SKU">{product.sku}</Fact>
              <Fact label="Price">
                <Num kind="money" value={product.price} /> per {UNIT_SINGULAR[product.unit]}
              </Fact>
              {can(SENSITIVE.productCost) ? (
                <Fact label="Cost">
                  <Num kind="unitCost" value={product.cost} /> per {UNIT_SINGULAR[product.unit]}
                </Fact>
              ) : null}
              {product.sqFtPerCarton ? (
                <Fact label="Coverage">
                  <Num kind="quantity" value={product.sqFtPerCarton} unit="sq ft per carton" />
                </Fact>
              ) : null}
              {product.category !== "service"
                ? warehousesOf(locations).map((w) => {
                    const s = stockLevel(product, { rolls, movements, reservations }, w.id);
                    const kind = s.unit === "each" ? "count" : "quantity";
                    return (
                      <Fact key={w.id} label={`Available at ${w.name}`}>
                        <span className="inline-flex items-center gap-2">
                          <StockBadge status={s.status} />
                          <Num kind={kind} value={s.available} unit={STOCK_UNIT_LABELS[s.unit]} />
                          <CartonHint quantity={s.available} sqFtPerCarton={product.sqFtPerCarton} compact />
                        </span>
                        <span className="text-muted-foreground block text-xs">
                          <Num kind={kind} value={s.onHand} /> on hand, <Num kind={kind} value={s.reserved} /> reserved
                        </span>
                      </Fact>
                    );
                  })
                : null}
              {Object.entries(product.attributes)
                .filter(([key]) => key !== "taxCategory")
                .map(([key, value]) => (
                  <Fact key={key} label={ATTRIBUTE_LABELS[key] ?? key}>
                    {value}
                  </Fact>
                ))}
            </dl>
            {own.length > 0 ? (
              <section className="px-4 pb-6">
                <h3 className="mb-2 text-sm font-semibold">Rolls</h3>
                <ul className="flex flex-col gap-1">
                  {own.map((roll) => (
                    <li key={roll.id}>
                      <Link
                        href={`/inventory/rolls/${roll.id}`}
                        className="hover:bg-raised flex items-center gap-3 rounded-md px-2 py-1.5 text-sm"
                      >
                        <span className="w-28 font-medium">{roll.rollNumber}</span>
                        <RollGauge
                          size="mini"
                          originalFt={Number(roll.originalLengthFt)}
                          remainingFt={Number(roll.remainingLengthFt)}
                          cutsFt={roll.cuts.map((c) => Number(c.lengthFt))}
                          label={`${roll.remainingLengthFt} ft of ${roll.originalLengthFt} ft left`}
                          className="w-24"
                        />
                        <Num kind="quantity" value={roll.remainingLengthFt} unit="ft" className="ml-auto" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {adjusting ? (
              <AdjustStockDialog product={product} locations={locations} onClose={() => setAdjusting(false)} />
            ) : null}
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
