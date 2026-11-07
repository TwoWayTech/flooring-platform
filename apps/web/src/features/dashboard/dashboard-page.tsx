"use client";

import Link from "next/link";
import { FilePlus2 } from "lucide-react";
import { dataScope } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { AttentionPanel } from "./attention-panel";
import { RevenuePanel } from "./revenue-panel";
import { BestSellers, SlowMovers } from "./sellers-panels";
import { TodaysJobs } from "./todays-jobs";
import { useDashboardData } from "./use-dashboard-data";

/**
 * The Flooring dashboard (spec "Dashboard", design brief layout): one large revenue panel with
 * supporting columns. Each section appears only for viewers allowed to see its data.
 */
export function DashboardPage() {
  const can = useCan();
  const { roles, user, viewAsRole } = useWorkspace();
  const data = useDashboardData();
  const ownScope =
    (viewAsRole ? viewAsRole.dataScope : dataScope(roles.filter((r) => user.roleIds.includes(r.id)))) === "own";
  const sales = can("sales.invoice.view");

  return (
    <>
      <PageHeader
        title="Dashboard"
        actions={
          can("sales.quote.create") ? (
            <Button asChild>
              <Link href="/sales/quotes/new">
                <FilePlus2 />
                New quote
              </Link>
            </Button>
          ) : null
        }
      />
      {data.status !== "ready" ? (
        <div
          className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]"
          aria-busy="true"
          aria-label="Loading dashboard"
        >
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
          <div className="flex min-w-0 flex-col gap-6">
            {sales ? <RevenuePanel data={data.data} ownScope={ownScope} /> : null}
            <div className="grid gap-6 md:grid-cols-2">
              {sales ? <BestSellers rows={data.data.best} /> : null}
              {can("inventory.product.view") ? <SlowMovers rows={data.data.slow} /> : null}
            </div>
          </div>
          {/* On phones what needs action comes first; on desktop it is the side column. */}
          <div className="order-first flex min-w-0 flex-col gap-6 lg:order-none">
            <AttentionPanel />
            {can("installation.job.view") ? <TodaysJobs jobs={data.data.jobsToday} /> : null}
          </div>
        </div>
      )}
    </>
  );
}
