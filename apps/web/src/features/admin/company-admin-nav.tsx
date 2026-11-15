"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { featureOn } from "@workspace/shared";
import { cn } from "@workspace/ui/lib/utils";
import { isDemoMode } from "@/lib/data-source";

/** Back to the platform's company list, above every company page. */
export function BackToCompanies() {
  return (
    <Link
      href="/admin"
      className="text-muted-foreground hover:text-foreground -mb-3 inline-flex items-center gap-1 text-sm"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      Companies
    </Link>
  );
}

/**
 * The platform admin's pages for one company (spec G1, G2): its access, its status while
 * `admin.billing` is on (docs/specs/platform-admin.md, part 2, "Screens"), its support-access
 * requests (part 3, "Support tab"), and in the demo its data import and the database connection
 * planner. Import has not moved to the API yet, so in api mode those pages are not found and their
 * tabs are not offered (docs/specs/platform-admin.md, "Screens").
 */
export function CompanyAdminNav({ companyId }: { companyId: string }) {
  const pathname = usePathname();
  const base = `/admin/companies/${encodeURIComponent(companyId)}`;
  const items: (readonly [string, string])[] = [[base, "Access"]];
  if (featureOn("admin.billing")) items.push([`${base}/status`, "Status"]);
  items.push([`${base}/support`, "Support"]);
  if (isDemoMode()) items.push([`${base}/import`, "Data import"], [`${base}/database`, "Connect a database"]);
  return (
    <nav aria-label="Company pages" className="scrollbar-none -mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
      <ul className="border-hairline flex gap-1 border-b pb-2">
        {items.map(([href, label]) => (
          <li key={href}>
            <Link
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              className={cn(
                "inline-flex h-9 items-center rounded-md px-3 text-sm whitespace-nowrap",
                pathname === href ? "bg-brand-soft text-brand-ink font-medium" : "text-foreground/85 hover:bg-raised",
              )}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
