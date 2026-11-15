import type { ReactNode } from "react";
import { cn } from "@workspace/ui/lib/utils";

/**
 * A box that scrolls sideways when its table is wider than the screen. It is named and can take
 * focus, so keyboard users can reach it and scroll with the arrow keys (WCAG 2.1.1). `busy` marks
 * it `aria-busy` while newer content is on its way.
 */
export function ScrollRegion({
  label,
  className,
  busy,
  children,
}: {
  label: string;
  className?: string;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      aria-busy={busy || undefined}
      tabIndex={0}
      className={cn("relative overflow-x-auto", className)}
    >
      {children}
    </div>
  );
}
