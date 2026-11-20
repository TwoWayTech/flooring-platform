"use client";

import { QueryFallback } from "@/components/query-fallback";
import { useApiQuery } from "@/lib/api/use-api";
import { AccessEditor } from "./access-editor";
import { BackToCompanies } from "./company-admin-nav";

/**
 * Platform admin → Company → Access (docs/specs/platform-admin.md, "Screens"): reads the company and
 * its directory, then the editor. The company is named by the id in the address, which the API
 * uses for platform records only, never to open the company's own data.
 */
export function CompanyAccessPage({ companyId }: { companyId: string }) {
  const data = useApiQuery(
    async (client) => {
      const company = await client.getPlatformCompany(companyId);
      return company ? { company, directory: await client.getPlatformDirectory(company.id) } : null;
    },
    [companyId],
  );
  if (data.status !== "ready") return <QueryFallback query={data} className="h-96" label="Loading company" />;
  if (!data.data) return <p className="text-muted-foreground">This company does not exist.</p>;
  const { company, directory } = data.data;
  return (
    <>
      <BackToCompanies />
      <AccessEditor key={JSON.stringify(company)} company={company} directory={directory} />
    </>
  );
}
