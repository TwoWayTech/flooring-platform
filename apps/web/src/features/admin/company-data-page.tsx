"use client";

import { format, parseISO } from "date-fns";
import { PRODUCT_LABELS } from "@workspace/shared";
import { PageHeader } from "@workspace/ui/components/page-header";
import { QueryFallback } from "@/components/query-fallback";
import { ConnectDatabase } from "@/features/import/connect-database";
import { ImportWorkspace } from "@/features/import/import-workspace";
import { useApiQuery } from "@/lib/api/use-api";
import { BackToCompanies, CompanyAdminNav } from "./company-admin-nav";

/** Dates on platform pages, which belong to no company's date format. */
const platformDate = (iso: string, withTime = false) =>
  format(parseISO(iso), withTime && iso.length > 10 ? "MMM d, yyyy, h:mm a" : "MMM d, yyyy");

/**
 * Platform admin → Company → Data import or Connect a database (spec G1, G2): the same wizard
 * and planner a company's Owner has in Settings, run by the platform admin for onboarding. Demo
 * only: the routes are not found in api mode, since import has not moved to the API yet.
 */
export function CompanyDataPage({ companyId, view }: { companyId: string; view: "import" | "database" }) {
  const companies = useApiQuery((client) => client.listCompanies(), []);
  if (companies.status !== "ready") return <QueryFallback query={companies} className="h-96" label="Loading company" />;
  const company = companies.data.find((c) => c.id === companyId);
  if (!company) return <p className="text-muted-foreground">This company does not exist.</p>;
  return (
    <>
      <BackToCompanies />
      <PageHeader title={company.name} description={`${PRODUCT_LABELS[company.product]}, ${company.plan}`} />
      <CompanyAdminNav companyId={company.id} />
      {view === "import" ? (
        <ImportWorkspace companyId={company.id} formatDate={platformDate} />
      ) : (
        <ConnectDatabase companyId={company.id} importHref={`/admin/companies/${company.id}/import`} />
      )}
    </>
  );
}
