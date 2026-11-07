import type { ReactNode } from "react";
import { cn } from "@workspace/ui/lib/utils";

/**
 * A box that scrolls sideways when its table is wider than the screen. It is named and can take
 * focus, so keyboard users can reach it and scroll with the arrow keys (WCAG 2.1.1).
 */
export function ScrollRegion({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className={cn("relative overflow-x-auto", className)}>
      {children}
    </div>
  );
}
