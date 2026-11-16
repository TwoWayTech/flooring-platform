"use client";

import { FULL_IMPORT_HOLDER, PRODUCT_LABELS } from "@workspace/shared";
import { PageHeader } from "@workspace/ui/components/page-header";
import { QueryFallback } from "@/components/query-fallback";
import { ConnectDatabase } from "@/features/import/connect-database";
import { ImportWorkspace } from "@/features/import/import-workspace";
import { useApiQuery } from "@/lib/api/use-api";
import { useFormatDate } from "@/lib/use-format-date";
import { BackToCompanies, CompanyAdminNav } from "./company-admin-nav";

/**
 * Platform admin → Company → Data import or Connect a database (spec G1, G2): the same wizard
 * and planner a company's Owner has in Settings, run by the platform admin for onboarding, who
 * holds every key there as DemoStore does (`FULL_IMPORT_HOLDER`). Demo only: the routes are not
 * found in api mode, because importing into another company waits for support-grant use (ADR
 * 0057, part 5).
 */
export function CompanyDataPage({ companyId, view }: { companyId: string; view: "import" | "database" }) {
  const companies = useApiQuery((client) => client.listCompanies(), []);
  const formatDate = useFormatDate();
  if (companies.status !== "ready") return <QueryFallback query={companies} className="h-96" label="Loading company" />;
  const company = companies.data.find((c) => c.id === companyId);
  if (!company) return <p className="text-muted-foreground">This company does not exist.</p>;
  return (
    <>
      <BackToCompanies />
      <PageHeader title={company.name} description={`${PRODUCT_LABELS[company.product]}, ${company.plan}`} />
      <CompanyAdminNav companyId={company.id} />
      {view === "import" ? (
        <ImportWorkspace companyId={company.id} holder={FULL_IMPORT_HOLDER} formatDate={formatDate} />
      ) : (
        <ConnectDatabase companyId={company.id} importHref={`/admin/companies/${company.id}/import`} />
      )}
    </>
  );
}
