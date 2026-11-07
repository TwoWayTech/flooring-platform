import { cn } from "@workspace/ui/lib/utils";

/** A dye-lot style color chip shown beside product names. */
export function Swatch({ color, label, className }: { color: string; label: string; className?: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className={cn("border-hairline inline-block size-4 shrink-0 rounded-sm border", className)}
      style={{ backgroundColor: color }}
    />
  );
}
