import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { featureOn } from "@workspace/shared";
import { CompanyStatusPage } from "@/features/admin/company-status-page";

export const metadata: Metadata = { title: "Company status" };

/**
 * Platform admin: one company's status and the actions on it (docs/specs/platform-admin.md, part
 * 2). The page checks admin.billing first and is not found when it is off; the layout gates the
 * rest. The id is only a name here; the API checks it.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  if (!featureOn("admin.billing")) notFound();
  const { id } = await params;
  return <CompanyStatusPage companyId={id} />;
}
