import type { ReactNode } from "react";

/** One sentence and one action (design brief "Empty states"). */
export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 px-4 py-10 sm:items-center sm:text-center">
      <p className="text-muted-foreground">{message}</p>
      {action}
    </div>
  );
}
