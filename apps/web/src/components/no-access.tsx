import Link from "next/link";
import { Button } from "@workspace/ui/components/button";
import { EmptyState } from "@workspace/ui/components/empty-state";

/** Shown when the viewer's role does not include this page, for example while viewing as a role. */
export function NoAccess() {
  return (
    <EmptyState
      message="Your role does not include this page."
      action={
        <Button asChild variant="outline">
          <Link href="/">Go to your home page</Link>
        </Button>
      }
    />
  );
}
