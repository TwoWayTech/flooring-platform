import {
  cartonEquivalent,
  featureOn,
  isWholeCartons,
  UNIT_LABELS,
  type DamagedLine,
  type SellUnit,
} from "@workspace/shared";
import { Num } from "@workspace/ui/components/num";

/**
 * A damaged quantity in words (spec D2 rule 18; click-through #24): "1 carton damaged (19.80 sq
 * ft)" when it is whole cartons of a boxed good, otherwise "19.80 sq ft damaged". Damaged units
 * stay out of stock and off the bill, so the PO panel and the bill say what they were.
 */
export function DamagedQuantity({
  quantity,
  unit,
  sqFtPerCarton,
}: {
  quantity: string;
  unit: SellUnit;
  sqFtPerCarton?: string;
}) {
  const label = UNIT_LABELS[unit];
  if (sqFtPerCarton && featureOn("units.square-feet") && isWholeCartons(quantity, sqFtPerCarton)) {
    const { cartons } = cartonEquivalent(quantity, sqFtPerCarton);
    return (
      <>
        <Num kind="count" value={String(cartons)} /> {cartons === 1 ? "carton" : "cartons"} damaged (
        <Num kind="quantity" value={quantity} unit={label} />)
      </>
    );
  }
  return (
    <>
      <Num kind="quantity" value={quantity} unit={label} /> damaged
    </>
  );
}

/**
 * The damaged lines of some receipts, one sentence each: "GR-0054: Shoreline Plank Linen, 1 carton
 * damaged (19.80 sq ft)." Nothing when nothing was damaged.
 */
export function DamagedLines({ lines, className }: { lines: readonly DamagedLine[]; className?: string }) {
  if (lines.length === 0) return null;
  return (
    <ul className={className} aria-label="Damaged on arrival">
      {lines.map((l) => (
        <li key={`${l.receiptId}-${l.poLineId}`}>
          {l.receiptNumber}: {l.description},{" "}
          <DamagedQuantity quantity={l.damaged} unit={l.unit} sqFtPerCarton={l.sqFtPerCarton} />. Not billed.
        </li>
      ))}
    </ul>
  );
}
