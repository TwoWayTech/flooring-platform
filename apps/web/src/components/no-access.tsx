import Link from "next/link";
import { Button } from "@workspace/ui/components/button";
import { EmptyState } from "@workspace/ui/components/empty-state";

/**
 * Shown when a page is not open to the viewer: their role does not include it (for example while
 * viewing as a role), or its feature is switched off.
 */
export function NoAccess({ message = "Your role does not include this page." }: { message?: string }) {
  return (
    <EmptyState
      message={message}
      action={
        <Button asChild variant="outline">
          <Link href="/">Go to your home page</Link>
        </Button>
      }
    />
  );
}
