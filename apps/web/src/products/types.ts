import type { LucideIcon } from "lucide-react";
import type { FloorPattern, PermissionKey, ProductKey } from "@workspace/shared";

/** One entry in the sidebar, shown when the user holds any of its permissions. */
export interface MenuItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Holding any one of these shows the item. Effective access already reflects modules and ceiling. */
  anyOf: PermissionKey[];
}

/** What a product host shows: its name, menus and the branding used before a company is picked. */
export interface ProductConfig {
  key: ProductKey;
  name: string;
  /** Main menu, top to bottom. */
  menu: MenuItem[];
  /** Settings pages, listed under Settings and in the ⌘K palette. */
  settings: MenuItem[];
  defaultBranding: { brandColor: string; pattern: FloorPattern };
}
