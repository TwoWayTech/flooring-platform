"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { CompanyId } from "@workspace/shared";
import { cn } from "@workspace/ui/lib/utils";

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
 * The platform admin's pages for one company (spec G1, G2): its access, its data import and
 * the database connection planner.
 */
export function CompanyAdminNav({ companyId }: { companyId: CompanyId }) {
  const pathname = usePathname();
  const base = `/admin/companies/${companyId}`;
  const items = [
    [base, "Access"],
    [`${base}/import`, "Data import"],
    [`${base}/database`, "Connect a database"],
  ] as const;
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
