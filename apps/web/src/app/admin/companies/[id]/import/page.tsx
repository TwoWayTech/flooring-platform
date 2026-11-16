import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CompanyDataPage } from "@/features/admin/company-data-page";
import { isDemoMode } from "@/lib/data-source";

export const metadata: Metadata = { title: "Data import" };

/**
 * Super-admin: one company's data import (spec G1). Demo only: in api mode the page is not found,
 * not merely left out of the tabs, because importing into another company waits for support-grant
 * use (ADR 0057, part 5), and the demo store would answer for companies the API knows by other ids
 * (docs/specs/platform-admin.md, "Screens").
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  if (!isDemoMode()) notFound();
  const { id } = await params;
  return <CompanyDataPage companyId={id} view="import" />;
}
