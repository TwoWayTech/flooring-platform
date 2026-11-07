import type { Access, ProductKey } from "@workspace/shared";
import { FLOORING } from "./flooring";
import { HR } from "./hr";
import type { MenuItem, ProductConfig } from "./types";

/** Product configuration by key (spec section 1: apps/web/src/products). */
export const PRODUCTS: Record<ProductKey, ProductConfig> = { flooring: FLOORING, hr: HR };

/** Menu items the access allows; items whose permissions are all outside it disappear. */
export function visibleItems(items: readonly MenuItem[], access: Access): MenuItem[] {
  return items.filter((item) => item.anyOf.some((key) => access.permissions.has(key)));
}

/** A persona's home: the first menu item they may open (spec "Login": each persona lands on its allowed home). */
export function homeFor(product: ProductKey, access: Access): string {
  const config = PRODUCTS[product];
  return visibleItems([...config.menu, ...config.settings], access)[0]?.href ?? "/no-access";
}

export type { MenuItem, ProductConfig };
