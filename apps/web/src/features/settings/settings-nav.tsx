"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@workspace/ui/lib/utils";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { visibleItems } from "@/products";

/** Settings sub-navigation: a list beside the page on desktop, a scrolling row of tabs on phones. */
export function SettingsNav() {
  const { product, access } = useWorkspace();
  const pathname = usePathname();
  const items = visibleItems(product.settings, access);
  return (
    <nav aria-label="Settings" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0">
      <ul className="flex gap-1 lg:flex-col">
        {items.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-md px-2.5 text-sm whitespace-nowrap",
                  active ? "bg-brand-soft text-brand-ink font-medium" : "text-foreground/85 hover:bg-raised",
                )}
              >
                <item.icon
                  aria-hidden="true"
                  className={cn("size-4", active ? "text-brand-ink" : "text-muted-foreground")}
                />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
