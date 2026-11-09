"use client";

import type { CompanyId } from "@workspace/shared";
import { QueryFallback } from "@/components/query-fallback";
import { useApiQuery } from "@/lib/api/use-api";
import { ImportHistory } from "./import-history";
import { ImportWizard } from "./import-wizard";

/**
 * Data import for one company (spec G1): the wizard and the history with Undo. Settings and
 * Platform admin → Company both show it; the date format comes from where it is shown.
 */
export function ImportWorkspace({
  companyId,
  formatDate,
}: {
  companyId: CompanyId;
  formatDate: (iso: string, withTime?: boolean) => string;
}) {
  const overview = useApiQuery((client) => client.importOverview(companyId), [companyId], { keepDataOnError: true });
  if (overview.status !== "ready")
    return <QueryFallback query={overview} className="h-96" label="Loading data import" />;
  return (
    <>
      <ImportWizard companyId={companyId} overview={overview.data} />
      <ImportHistory companyId={companyId} batches={overview.data.batches} formatDate={formatDate} />
    </>
  );
}
