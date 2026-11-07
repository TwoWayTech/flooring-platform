import type { ReactNode } from "react";
import { cn } from "@workspace/ui/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** Page title in Unbounded with the page's primary actions; actions wrap under the title on phones. */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0">
        <h1 className="font-display text-xl leading-tight font-semibold tracking-[-0.01em] sm:text-2xl">{title}</h1>
        {description ? <p className="text-muted-foreground mt-1 max-w-prose">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
