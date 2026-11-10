import { cartonEquivalent, featureOn } from "@workspace/shared";
import { Num } from "@workspace/ui/components/num";
import { cn } from "@workspace/ui/lib/utils";

interface CartonHintProps {
  /** Area in sq ft. */
  quantity: string;
  /** Coverage of one carton; without it there is nothing to show. */
  sqFtPerCarton?: string;
  /** Leaves out "(23.64 sq ft each)", for table rows. */
  compact?: boolean;
  className?: string;
}

/**
 * The carton equivalent beside an area (spec A1): "≈ 22 cartons (23.64 sq ft each)". Square feet
 * is the one unit; this is the hint for people who think in boxes. Partial cartons round up.
 */
export function CartonHint({ quantity, sqFtPerCarton, compact = false, className }: CartonHintProps) {
  if (!sqFtPerCarton || !featureOn("units.square-feet")) return null;
  const { cartons } = cartonEquivalent(quantity || "0", sqFtPerCarton);
  return (
    <span className={cn("text-muted-foreground text-xs font-normal", className)}>
      ≈ <Num kind="count" value={String(cartons)} /> {cartons === 1 ? "carton" : "cartons"}
      {compact ? null : (
        <>
          {" "}
          (<Num kind="quantity" value={sqFtPerCarton} /> sq ft each)
        </>
      )}
    </span>
  );
}
