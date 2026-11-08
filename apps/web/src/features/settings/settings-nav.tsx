"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { visibleItems, type MenuItem } from "@/products";
import { SETTINGS_GROUPS, type SettingsGroup } from "@/products/settings-menu";

function NavItem({ item, active }: { item: Pick<MenuItem, "href" | "label" | "icon">; active: boolean }) {
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-9 items-center gap-2 rounded-md px-2.5 text-sm whitespace-nowrap",
          active ? "bg-brand-soft text-brand-ink font-medium" : "text-foreground/85 hover:bg-raised",
        )}
      >
        <item.icon aria-hidden="true" className={cn("size-4", active ? "text-brand-ink" : "text-muted-foreground")} />
        {item.label}
      </Link>
    </li>
  );
}

/**
 * Settings sub-navigation (spec A4): All settings, then the pages by group. A list beside the
 * page on desktop, a scrolling row on phones.
 */
export function SettingsNav() {
  const { product, access } = useWorkspace();
  const pathname = usePathname();
  const items = visibleItems(product.settings, access);
  const groups = (Object.keys(SETTINGS_GROUPS) as SettingsGroup[])
    .map((group) => ({ group, items: items.filter((i) => i.group === group) }))
    .filter((g) => g.items.length > 0);
  return (
    <nav
      aria-label="Settings"
      className="scrollbar-none -mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0"
    >
      <ul className="flex gap-1 lg:flex-col">
        <NavItem
          item={{ href: "/settings", label: "All settings", icon: LayoutGrid }}
          active={pathname === "/settings"}
        />
        {groups.map(({ group, items: groupItems }) => (
          <li key={group} className="contents lg:block">
            <span className="text-muted-foreground hidden px-2.5 pt-3 pb-1 text-xs font-medium lg:block">
              {SETTINGS_GROUPS[group]}
            </span>
            <ul className="contents lg:flex lg:flex-col lg:gap-1">
              {groupItems.map((item) => (
                <NavItem key={item.href} item={item} active={pathname.startsWith(item.href)} />
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}
