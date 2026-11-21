"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { visibleItems, type MenuItem } from "@/products";
import { SETTINGS_GROUPS, type SettingsGroup } from "@/products/settings-menu";

/** Where the menu becomes a list beside the page: `lg`, or 1400 px for a page that needs the width. */
export type NavWidth = "normal" | "wide";

/** The menu's classes per width; written out in full so Tailwind finds them. */
const CLASSES: Record<NavWidth, Record<"nav" | "list" | "group" | "heading" | "items", string>> = {
  normal: {
    nav: "lg:mx-0 lg:overflow-visible lg:px-0",
    list: "lg:flex-col",
    group: "lg:block",
    heading: "lg:block",
    items: "lg:flex lg:flex-col lg:gap-1",
  },
  wide: {
    nav: "min-[1400px]:mx-0 min-[1400px]:overflow-visible min-[1400px]:px-0",
    list: "min-[1400px]:flex-col",
    group: "min-[1400px]:block",
    heading: "min-[1400px]:block",
    items: "min-[1400px]:flex min-[1400px]:flex-col min-[1400px]:gap-1",
  },
};

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
 * page on desktop, a scrolling row on phones, and on a wide page a row until 1400 px.
 */
export function SettingsNav({ width = "normal" }: { width?: NavWidth }) {
  const { product, access } = useWorkspace();
  const pathname = usePathname();
  const items = visibleItems(product.settings, access);
  const groups = (Object.keys(SETTINGS_GROUPS) as SettingsGroup[])
    .map((group) => ({ group, items: items.filter((i) => i.group === group) }))
    .filter((g) => g.items.length > 0);
  const classes = CLASSES[width];
  return (
    <nav aria-label="Settings" className={cn("scrollbar-none -mx-4 overflow-x-auto px-4", classes.nav)}>
      <ul className={cn("flex gap-1", classes.list)}>
        <NavItem
          item={{ href: "/settings", label: "All settings", icon: LayoutGrid }}
          active={pathname === "/settings"}
        />
        {groups.map(({ group, items: groupItems }) => (
          <li key={group} className={cn("contents", classes.group)}>
            <span className={cn("text-muted-foreground hidden px-2.5 pt-3 pb-1 text-xs font-medium", classes.heading)}>
              {SETTINGS_GROUPS[group]}
            </span>
            <ul className={cn("contents", classes.items)}>
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
