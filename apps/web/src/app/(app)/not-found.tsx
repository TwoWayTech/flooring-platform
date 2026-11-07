import Link from "next/link";
import { Button } from "@workspace/ui/components/button";
import { EmptyState } from "@workspace/ui/components/empty-state";

/** Unknown pages inside the app: say so and offer the way home. */
export default function NotFound() {
  return (
    <EmptyState
      message="This page does not exist or you do not have access to it."
      action={
        <Button asChild variant="outline">
          <Link href="/">Go to your home page</Link>
        </Button>
      }
    />
  );
}
