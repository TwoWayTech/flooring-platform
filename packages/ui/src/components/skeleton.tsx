/**
 * shadcn/ui skeleton (Radix base, CLI 4.23), vendored. Styling comes from the design tokens;
 * the API follows the shadcn docs. See docs/adr/0002-vendored-ui-primitives.md.
 */
import { cn } from "@workspace/ui/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="skeleton" className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

export { Skeleton };
