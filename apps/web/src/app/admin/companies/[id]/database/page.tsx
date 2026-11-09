import type { Metadata } from "next";
import type { CompanyId } from "@workspace/shared";
import { CompanyDataPage } from "@/features/admin/company-data-page";

export const metadata: Metadata = { title: "Connect a database" };

/** Super-admin: plan a database connection for one company (spec G2). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CompanyDataPage companyId={id as CompanyId} view="database" />;
}
