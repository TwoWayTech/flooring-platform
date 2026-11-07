"use client";

import Link from "next/link";
import { SENSITIVE, UNIT_SINGULAR, type Product, type Roll } from "@workspace/shared";
import { Num } from "@workspace/ui/components/num";
import { RollGauge } from "@workspace/ui/components/roll-gauge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet";
import { Swatch } from "@workspace/ui/components/swatch";
import { useCan } from "@/components/workspace/workspace-context";
import { CATEGORY_LABELS } from "@/lib/labels";
import { stockLevel } from "./stock";

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

/** A product's details in a side drawer: price, stock, attributes, and its rolls for broadloom. */
export function ProductDrawer({
  product,
  rolls,
  onClose,
}: {
  product: Product | null;
  rolls: Roll[];
  onClose: () => void;
}) {
  const can = useCan();
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
              {product.category !== "service" ? (
                <Fact label="In stock">
                  {(() => {
                    const s = stockLevel(product, rolls);
                    return <Num kind={s.unit === "ft" ? "quantity" : "count"} value={s.value} unit={s.unit} />;
                  })()}
                </Fact>
              ) : null}
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
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
