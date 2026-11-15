import { featureOn, type Access, type ProductKey } from "@workspace/shared";
import { isDemoMode } from "@/lib/data-source";
import { FLOORING } from "./flooring";
import { HR } from "./hr";
import type { MenuItem, ProductConfig } from "./types";

/** Product configuration by key (spec section 1: apps/web/src/products). */
export const PRODUCTS: Record<ProductKey, ProductConfig> = { flooring: FLOORING, hr: HR };

/**
 * Whether the access opens a menu item or page: an Owner-only one needs the company's Owner (as View
 * as shows them; docs/specs/platform-admin.md, part 4), any other one a permission from `anyOf`.
 * The menus, the palette, the page gate and the access preview all ask this one rule.
 */
export function itemAllows(item: Pick<MenuItem, "anyOf" | "ownerOnly">, access: Access): boolean {
  return item.ownerOnly ? access.isOwner : item.anyOf.some((key) => access.permissions.has(key));
}

/** Whether an item exists in this build: a demo-only page is left out in api mode (`MenuItem.demoOnly`). */
export function inThisBuild(item: Pick<MenuItem, "demoOnly">): boolean {
  return !item.demoOnly || isDemoMode();
}

/** Menu items the access allows, whose feature is switched on and that exist in this build; the rest disappear. */
export function visibleItems(items: readonly MenuItem[], access: Access): MenuItem[] {
  return items.filter(
    (item) => inThisBuild(item) && item.features.some((key) => featureOn(key)) && itemAllows(item, access),
  );
}

/** A persona's home: the first menu item they may open (spec "Login": each persona lands on its allowed home). */
export function homeFor(product: ProductKey, access: Access): string {
  const config = PRODUCTS[product];
  return visibleItems([...config.menu, ...config.settings], access)[0]?.href ?? "/no-access";
}

export type { MenuItem, ProductConfig };
