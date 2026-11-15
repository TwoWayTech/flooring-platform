import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { featureOn } from "@workspace/shared";
import { PlansPage } from "@/features/admin/plans-page";

export const metadata: Metadata = { title: "Plans" };

/**
 * Platform admin: plans as data (docs/specs/platform-admin.md, part 2). The layout checks the
 * platform gate and admin.access; this page checks admin.billing itself, because `featureForPath`
 * attributes /admin/plans to admin.access, whose /admin/* wildcard outranks an exact path.
 */
export default function Page() {
  if (!featureOn("admin.billing")) notFound();
  return <PlansPage />;
}
