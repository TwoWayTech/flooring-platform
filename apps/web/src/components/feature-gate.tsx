"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { featureForPath, featureOn } from "@workspace/shared";
import { NoAccess } from "@/components/no-access";
import { useWorkspace } from "@/components/workspace/workspace-context";

/**
 * Shows the page only while the feature that owns its route is switched on (docs/FEATURES.md), so
 * a typed or bookmarked address cannot reach a switched-off feature. "/" is left to the home page,
 * which sends people to their first page when the dashboard is off.
 */
export function FeatureGate({ children }: { children: ReactNode }) {
  const { product } = useWorkspace();
  const pathname = usePathname();
  const view = useSearchParams().get("view");
  const key = pathname === "/" ? null : featureForPath(product.key, view ? `${pathname}?view=${view}` : pathname);
  if (key && !featureOn(key)) return <NoAccess message="This feature is switched off in this demo." />;
  return <>{children}</>;
}
