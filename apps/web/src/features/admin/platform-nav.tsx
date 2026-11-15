"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@workspace/ui/lib/utils";

/** The console's two sections and when each is the current one. */
const SECTIONS: readonly { href: string; label: string; current: (pathname: string) => boolean }[] = [
  {
    href: "/admin",
    label: "Companies",
    current: (pathname) => pathname === "/admin" || pathname.startsWith("/admin/companies/"),
  },
  { href: "/admin/audit", label: "Audit log", current: (pathname) => pathname === "/admin/audit" },
];

/**
 * The console's sections under its header (docs/specs/platform-admin.md, part 3, "Screens",
 * Platform nav): Companies, current on the list and every company page, and the platform audit
 * log. It looks like the company tabs and scrolls sideways on a phone. A section holding the page
 * is marked current as a whole; only the exact page is `aria-current="page"`.
 */
export function PlatformNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Platform" className="border-hairline scrollbar-none overflow-x-auto border-b px-4 lg:px-8">
      <ul className="flex gap-1 py-2">
        {SECTIONS.map(({ href, label, current }) => {
          const here = current(pathname);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={here ? (pathname === href ? "page" : "true") : undefined}
                className={cn(
                  "inline-flex h-9 items-center rounded-md px-3 text-sm whitespace-nowrap",
                  here ? "bg-brand-soft text-brand-ink font-medium" : "text-foreground/85 hover:bg-raised",
                )}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
