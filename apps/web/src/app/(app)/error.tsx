"use client";

import Link from "next/link";
import { RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@workspace/ui/components/button";

/**
 * Catches an unexpected error on a screen and keeps the shell around it, so the presenter can try
 * again or move on (spec Tier 3 "error states").
 */
export default function ScreenError({ error, retry }: { error: unknown; retry: () => void }) {
  const detail = error instanceof Error && error.message ? error.message : "No details were given.";
  return (
    <div
      role="alert"
      className="border-hairline flex flex-col items-start gap-3 rounded-md border border-dashed px-5 py-10 sm:items-center sm:text-center"
    >
      <TriangleAlert aria-hidden="true" className="text-warning-ink size-5" />
      <div className="flex flex-col gap-1">
        <p className="font-medium">This screen stopped working.</p>
        <p className="text-muted-foreground text-sm">{detail}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={retry}>
          <RotateCw />
          Try again
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href="/">Go to your home page</Link>
        </Button>
      </div>
    </div>
  );
}
