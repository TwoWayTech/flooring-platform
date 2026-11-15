import type { Metadata } from "next";
import { CompanySupportPage } from "@/features/admin/company-support-page";

export const metadata: Metadata = { title: "Support access" };

/**
 * Platform admin: one company's support-access requests (docs/specs/platform-admin.md, part 3). The
 * id is only a name here; the API checks it, and the layout gates the page.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CompanySupportPage companyId={id} />;
}
