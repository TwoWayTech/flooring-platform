import type { ReactNode } from "react";
import { cn } from "@workspace/ui/lib/utils";

interface PanelProps {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

/** A Paper surface on the Limestone canvas: depth from the surface step and a hairline, no shadow. */
export function Panel({ title, actions, children, className, bodyClassName }: PanelProps) {
  return (
    <section className={cn("bg-surface border-hairline rounded-panel min-w-0 border", className)}>
      {title || actions ? (
        <header className="border-hairline flex min-h-12 items-center justify-between gap-3 border-b px-4 py-2">
          {title ? <h2 className="text-sm font-semibold">{title}</h2> : <span />}
          {actions}
        </header>
      ) : null}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}
