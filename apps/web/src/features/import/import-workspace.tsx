"use client";

import type { CompanyId, ImportHolder } from "@workspace/shared";
import { QueryFallback } from "@/components/query-fallback";
import { useApiQuery } from "@/lib/api/use-api";
import { ImportHistory } from "./import-history";
import { ImportWizard } from "./import-wizard";

/**
 * Data import for one company (spec G1): the wizard and the history with Undo. Settings and
 * Platform admin → Company both show it; the date format and the importer's access (`holder`,
 * which keeps sensitive columns they can't use from being chosen for them; ADR 0057 S-20) come
 * from where it is shown.
 */
export function ImportWorkspace({
  companyId,
  holder,
  formatDate,
}: {
  companyId: CompanyId;
  holder: ImportHolder;
  formatDate: (iso: string, withTime?: boolean) => string;
}) {
  const overview = useApiQuery((client) => client.importOverview(companyId), [companyId], { keepDataOnError: true });
  if (overview.status !== "ready")
    return <QueryFallback query={overview} className="h-96" label="Loading data import" />;
  return (
    <>
      <ImportWizard companyId={companyId} overview={overview.data} holder={holder} />
      <ImportHistory companyId={companyId} batches={overview.data.batches} formatDate={formatDate} />
    </>
  );
}
