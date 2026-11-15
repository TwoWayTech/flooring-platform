"use client";

import type { ReactNode } from "react";
import type { PlatformCompany } from "@workspace/shared";
import { Num } from "@workspace/ui/components/num";
import { Panel } from "@workspace/ui/components/panel";
import { useFormatDate } from "@/lib/use-format-date";
import { CompanyPhasePill, CompanyStatusPill } from "./company-status";
import { DATABASE_LABELS, databaseErrorText, MAINTENANCE_LABELS } from "./database-labels";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/**
 * Where a company stands, as the console may see it (docs/specs/platform-admin.md, "Fields"): its
 * status, life-cycle phase, members and database. The database shows its state, its schema and,
 * after a failed update, the error code (part 3, "Database errors and maintenance"). The error text
 * can quote the company's own rows, so the API never sends it and no role sees it here. A company
 * with no database row (the demo) shows no database line.
 */
export function CompanyFacts({ company }: { company: PlatformCompany }) {
  const { database, maintenance } = company;
  const formatDate = useFormatDate();
  const errorText = databaseErrorText(database);
  return (
    <Panel title="Account">
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Status">
          <span className="flex flex-wrap items-center gap-2">
            <CompanyStatusPill status={company.status} />
            <span className="text-muted-foreground text-xs">since {formatDate(company.statusChangedAt)}</span>
          </span>
        </Fact>
        <Fact label="Phase">
          <CompanyPhasePill phase={company.phase} />
        </Fact>
        <Fact label="Members">
          <span className="font-medium tabular-nums">
            <Num kind="count" value={company.members} />
          </span>
          <span className="text-muted-foreground block text-xs">People who can sign in, not seats in use.</span>
        </Fact>
        {database.status ? (
          <Fact label="Database">
            <span className="font-medium">{DATABASE_LABELS[database.status]}</span>
            {database.schemaVersion ? (
              <span className="text-muted-foreground block text-xs">Schema {database.schemaVersion}</span>
            ) : null}
            {errorText ? (
              <>
                <span className="text-danger-ink block text-xs font-medium tabular-nums">{errorText}</span>
                <span className="text-muted-foreground block text-xs">
                  The error text stays in the control database: it can hold the company&apos;s data.
                </span>
              </>
            ) : null}
          </Fact>
        ) : null}
        {maintenance.on ? (
          <Fact label="Maintenance">{maintenance.reason ? MAINTENANCE_LABELS[maintenance.reason] : "On"}</Fact>
        ) : null}
      </dl>
    </Panel>
  );
}
