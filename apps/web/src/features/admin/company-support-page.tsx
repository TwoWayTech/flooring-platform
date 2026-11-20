"use client";

import { useMemo, useState } from "react";
import { LifeBuoy } from "lucide-react";
import { featureOn, SUPPORT_OPEN_MESSAGE, seesAllSupportGrants, type PlatformSupportGrant } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Panel } from "@workspace/ui/components/panel";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { QueryFallback } from "@/components/query-fallback";
import { useApiQuery } from "@/lib/api/use-api";
import { isDemoMode } from "@/lib/data-source";
import { useFormatDate } from "@/lib/use-format-date";
import { BackToCompanies, CompanyAdminNav } from "./company-admin-nav";
import { usePlatformRole } from "./platform-role";
import { SUPPORT_STATUS, SupportGrantStatusPill } from "./support-grant-status";
import { SupportRequestDialog } from "./support-request-dialog";

/** Whether the admin's own request still blocks a new one: pending or approved, so not yet closed. */
function blocksNewRequest(grant: PlatformSupportGrant): boolean {
  return grant.mine && (grant.status === "pending" || grant.status === "approved");
}

/** Who asked: the admin's name, with "(you)" on the viewer's own requests. */
function requesterText(grant: PlatformSupportGrant): string {
  return grant.mine ? `${grant.admin.name} (you)` : grant.admin.name;
}

/** The request list's columns: when, who, why, until when and the derived status. No export. */
function useGrantColumns(): ColumnSpec<PlatformSupportGrant>[] {
  const formatDate = useFormatDate();
  return useMemo(
    () => [
      {
        id: "requested",
        header: "Requested",
        value: (g) => g.requestedAt,
        cell: (g) => formatDate(g.requestedAt, true),
      },
      { id: "by", header: "By", value: requesterText },
      { id: "reason", header: "Reason", value: (g) => g.reason, className: "min-w-64 max-w-md whitespace-normal" },
      { id: "ends", header: "Ends", value: (g) => g.expiresAt, cell: (g) => formatDate(g.expiresAt, true) },
      {
        id: "status",
        header: "Status",
        value: (g) => SUPPORT_STATUS[g.status].label,
        cell: (g) => <SupportGrantStatusPill status={g.status} />,
      },
    ],
    [formatDate],
  );
}

/**
 * Platform admin → Company → Support (docs/specs/platform-admin.md, part 3, "Support tab"): the
 * company's support-access requests with their status, and the way to ask its Owner for read-only
 * access. The owner role sees every admin's requests, the support role only its own (the API
 * filters; the page says so). The button waits while the admin's own request is pending or
 * approved, as the API's 409 would. Approved access opens nothing yet.
 */
export function CompanySupportPage({ companyId }: { companyId: string }) {
  const role = usePlatformRole();
  const columns = useGrantColumns();
  const [asking, setAsking] = useState(false);
  const data = useApiQuery(
    async (client) => {
      const company = await client.getPlatformCompany(companyId);
      return company ? { company, grants: await client.listPlatformSupportGrants(company.id) } : null;
    },
    [companyId],
  );
  if (data.status !== "ready") return <QueryFallback query={data} className="h-96" label="Loading support access" />;
  if (!data.data) return <p className="text-muted-foreground">This company does not exist.</p>;
  const { company, grants } = data.data;
  const blocked = grants.some(blocksNewRequest);
  // The Owner answers on Settings → Users; with that switched off no request may start (rule 13).
  const canAsk = featureOn("settings.users");

  return (
    <>
      <BackToCompanies />
      <PageHeader title={company.name} description="Support access" />
      <CompanyAdminNav companyId={company.id} />
      <Panel bodyClassName="flex flex-col gap-4">
        <div className="text-muted-foreground flex max-w-prose flex-col gap-1 text-sm">
          <p>
            Ask this company&apos;s Owner for read-only access for a few hours. The Owner approves or revokes it in
            Settings. Approved access doesn&apos;t open the company&apos;s data yet.
          </p>
          {seesAllSupportGrants(role) ? null : <p>You see your own requests.</p>}
        </div>
        {canAsk ? (
          <div className="flex flex-col items-start gap-1.5">
            <Button
              onClick={() => setAsking(true)}
              disabled={blocked}
              aria-describedby={blocked ? "support-open-hint" : undefined}
            >
              <LifeBuoy />
              Ask for support access
            </Button>
            {blocked ? (
              <p id="support-open-hint" className="text-muted-foreground text-xs">
                {SUPPORT_OPEN_MESSAGE}
              </p>
            ) : null}
          </div>
        ) : null}
      </Panel>
      <DataTable
        id="platform-support"
        rows={grants}
        columns={columns}
        getRowId={(g) => g.id}
        searchPlaceholder="Search requests"
        initialSort={{ id: "requested", desc: true }}
        empty={{ message: "No support requests for this company yet." }}
      />
      {asking && canAsk ? (
        <SupportRequestDialog
          company={company}
          onClose={() => setAsking(false)}
          // Every write the API answered reads again, but not a 429 limit refusal (ADR 0051, 2026-11-16),
          // and the Request button depends on the limit; the demo's list doesn't change on a refusal.
          onRefused={isDemoMode() ? () => undefined : data.retry}
        />
      ) : null}
    </>
  );
}
