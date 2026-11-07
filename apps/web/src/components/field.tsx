import type { ReactNode } from "react";
import { Label } from "@workspace/ui/components/label";
import { cn } from "@workspace/ui/lib/utils";

interface FieldProps {
  id: string;
  label: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** A form field: label above, the control, then an optional hint (design brief "Forms"). */
export function Field({ id, label, hint, className, children }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
