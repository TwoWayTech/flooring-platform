"use client";

/**
 * shadcn/ui label (Radix base, CLI 4.23), vendored. Styling comes from the design tokens;
 * the API follows the shadcn docs. See docs/adr/0002-vendored-ui-primitives.md.
 */
import * as React from "react";
import { cn } from "@workspace/ui/lib/utils";
import { Label as LabelPrimitive } from "radix-ui";

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
