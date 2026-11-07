import type { Metadata } from "next";
import type { CompanyId } from "@workspace/shared";
import { CompanyAccessPage } from "@/features/admin/company-access-page";

export const metadata: Metadata = { title: "Company access" };

/** Super-admin: one company's access. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CompanyAccessPage companyId={id as CompanyId} />;
}
