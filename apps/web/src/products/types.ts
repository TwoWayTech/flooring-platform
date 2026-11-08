import type { LucideIcon } from "lucide-react";
import { type FeatureKey, type FloorPattern, type PermissionKey, type ProductKey } from "@workspace/shared";
import type { SettingsGroup } from "./settings-menu";

/** One entry in the sidebar, shown when the user holds any of its permissions. */
export interface MenuItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Holding any one of these shows the item. Effective access already reflects modules and ceiling. */
  anyOf: PermissionKey[];
  /** Feature switches behind the item (docs/FEATURES.md); it shows while any of them is on. */
  features: FeatureKey[];
  /** Settings pages only: the group on the settings home and one sentence saying what it controls. */
  group?: SettingsGroup;
  description?: string;
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
