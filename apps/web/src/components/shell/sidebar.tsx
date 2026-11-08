"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { visibleItems, type MenuItem } from "@/products";
import { CompanySwitcher } from "./company-switcher";
import { ViewAsSwitcher } from "./view-as";

/** Whether a menu item is the current page: "/" matches exactly, others by path prefix. */
export function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, active, onNavigate }: { item: MenuItem; active: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors",
        active ? "bg-brand-soft text-brand-ink font-medium" : "text-foreground/85 hover:bg-raised",
      )}
    >
      <Icon aria-hidden="true" className={cn("size-4", active ? "text-brand-ink" : "text-muted-foreground")} />
      {item.label}
    </Link>
  );
}

/**
 * The sidebar (design brief "App shell"): company header with its pattern swatch, the product's
 * menu filtered by effective access, then Settings and "View as".
 */
export function Sidebar({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  const { product, access } = useWorkspace();
  const pathname = usePathname();
  const menu = visibleItems(product.menu, access);
  const settings = visibleItems(product.settings, access);
  const settingsItem: MenuItem | null = settings[0]
    ? { ...settings[0], href: "/settings", label: "Settings", icon: Settings }
    : null;

  return (
    <div className={cn("flex h-full flex-col gap-4 px-3 py-4", className)}>
      <CompanySwitcher />
      <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5">
        {menu.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} onNavigate={onNavigate} />
        ))}
      </nav>
      <div className="border-hairline flex flex-col gap-0.5 border-t pt-3">
        {settingsItem ? (
          <NavLink item={settingsItem} active={pathname.startsWith("/settings")} onNavigate={onNavigate} />
        ) : null}
        <ViewAsSwitcher />
      </div>
    </div>
  );
}
