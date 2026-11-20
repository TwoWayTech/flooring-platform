"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { featureOn, type Company } from "@workspace/shared";
import { PageHeader } from "@workspace/ui/components/page-header";
import { cn } from "@workspace/ui/lib/utils";
import { NoAccess } from "@/components/no-access";
import { QueryFallback } from "@/components/query-fallback";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import type { MyPortal } from "@/lib/api/contract";
import { useApiQuery } from "@/lib/api/use-api";

/**
 * The portal pages this person has. Anything hidden is left out, not greyed out (spec C2). My
 * meetings needs `meetings.calendar` and the company's meetings module (ADR 0051 "Part 3").
 */
function tabsFor(p: MyPortal, company: Pick<Company, "modules">) {
  const w2 = p.employee?.workerType === "w2";
  const contractor = p.employee?.workerType === "1099";
  return [
    { href: "/my", label: "Overview", show: true },
    { href: "/my/timesheet", label: "My timesheet", show: p.usesTimesheet },
    { href: "/my/time-off", label: "My time off", show: w2 },
    { href: "/my/pay", label: "My pay", show: p.visible.pay },
    { href: "/my/commission", label: "My commission", show: p.visible.commission },
    { href: "/my/payments", label: "My payments", show: contractor },
    { href: "/my/documents", label: "My documents", show: !!p.employee },
    {
      href: "/my/meetings",
      label: "My meetings",
      show: featureOn("meetings.calendar") && company.modules.includes("meetings"),
    },
    { href: "/my/profile", label: "My profile", show: !!p.employee },
  ].filter((t) => t.show);
}

/** Frames a portal page: the title, the portal's own tabs and the signed-in person's data (spec C2). */
export function MyShell({ title, children }: { title: string; children: (portal: MyPortal) => ReactNode }) {
  const can = useCan();
  const { company } = useWorkspace();
  const pathname = usePathname();
  // Every portal write reads again; a failed re-read keeps the page, so a form holding typed hours stays.
  const data = useApiQuery((client) => client.myPortal(), [], { keepDataOnError: true });
  if (!can("hr.portal.view")) return <NoAccess />;
  return (
    <>
      <PageHeader title={title} />
      {data.status !== "ready" ? (
        <QueryFallback query={data} className="h-96" label="Loading your portal" />
      ) : (
        <>
          <nav aria-label="My portal" className="scrollbar-none -mx-4 overflow-x-auto px-4">
            <ul className="border-hairline flex gap-4 border-b">
              {tabsFor(data.data, company).map((t) => {
                const active = t.href === "/my" ? pathname === "/my" : pathname.startsWith(t.href);
                return (
                  <li key={t.href}>
                    <Link
                      href={t.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "-mb-px inline-flex h-10 items-center border-b-2 px-1 text-sm whitespace-nowrap",
                        active
                          ? "border-brand text-foreground font-medium"
                          : "text-muted-foreground hover:text-foreground border-transparent",
                      )}
                    >
                      {t.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          {children(data.data)}
        </>
      )}
    </>
  );
}
