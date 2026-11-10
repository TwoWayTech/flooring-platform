"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@workspace/ui/lib/utils";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { pathOn } from "@workspace/shared";

const TABS = [
  { href: "/hr", label: "Home", permission: "hr.overview.view" },
  { href: "/hr/employees", label: "People", permission: "hr.employee.view" },
  { href: "/hr/timesheets", label: "Timesheets", permission: "hr.timesheet.view" },
  { href: "/hr/time-off", label: "Time off", permission: "hr.pto.view" },
  { href: "/hr/commissions", label: "Commissions", permission: "hr.commission.view" },
  { href: "/hr/pay-periods", label: "Pay periods", permission: "hr.payroll.view" },
] as const;

/**
 * HR section tabs for flooring companies, whose sidebar has a single HR entry. The HR host lists
 * these pages in its sidebar instead, so the tabs stay hidden there.
 */
export function HrTabs() {
  const can = useCan();
  const { product } = useWorkspace();
  const pathname = usePathname();
  if (product.key === "hr") return null;
  return (
    <nav aria-label="HR" className="scrollbar-none -mx-4 overflow-x-auto px-4">
      <ul className="border-hairline flex gap-4 border-b">
        {TABS.filter((t) => can(t.permission) && pathOn(product.key, t.href)).map((t) => {
          const active = t.href === "/hr" ? pathname === "/hr" : pathname.startsWith(t.href);
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
  );
}
