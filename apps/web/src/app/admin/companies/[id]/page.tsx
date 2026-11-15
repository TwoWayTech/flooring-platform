import type { Metadata } from "next";
import { CompanyAccessPage } from "@/features/admin/company-access-page";

export const metadata: Metadata = { title: "Company access" };

/** Platform admin: one company's access. The id is only a name here; the API checks it. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CompanyAccessPage companyId={id} />;
}
