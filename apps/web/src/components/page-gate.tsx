"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { featureForPath, featureOn } from "@workspace/shared";
import { NoAccess } from "@/components/no-access";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { canOpenPage } from "@/products/pages";

/**
 * Shows the page only while its feature is switched on (docs/FEATURES.md) and the viewer holds
 * the page's view permission (spec A3), so a typed or bookmarked address cannot reach either.
 * "/" is left to the home page, which sends people to their first page they may open.
 */
export function PageGate({ children }: { children: ReactNode }) {
  const { product, access } = useWorkspace();
  const pathname = usePathname();
  const view = useSearchParams().get("view");
  const href = view ? `${pathname}?view=${view}` : pathname;
  const key = pathname === "/" ? null : featureForPath(product.key, href);
  if (key && !featureOn(key)) return <NoAccess message="This feature is switched off in this demo." />;
  if (!canOpenPage(product.key, href, access)) return <NoAccess />;
  return <>{children}</>;
}
