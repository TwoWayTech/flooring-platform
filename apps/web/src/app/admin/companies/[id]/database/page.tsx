import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CompanyDataPage } from "@/features/admin/company-data-page";
import { isDemoMode } from "@/lib/data-source";

export const metadata: Metadata = { title: "Connect a database" };

/**
 * Super-admin: plan a database connection for one company (spec G2). Demo only: in api mode the
 * page is not found, as data import is (docs/specs/platform-admin.md, "Screens").
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  if (!isDemoMode()) notFound();
  const { id } = await params;
  return <CompanyDataPage companyId={id} view="database" />;
}
