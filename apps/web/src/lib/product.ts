import type { ProductKey } from "@workspace/shared";

/** Request header the proxy sets so server components know which product this host serves. */
export const PRODUCT_HEADER = "x-demo-product";
/** Cookie that remembers `?product=hr` on localhost, where there is no HR hostname. */
export const PRODUCT_COOKIE = "demo_product";

/**
 * Product by hostname (spec section 1): hosts starting `hr-demo` serve the HR Suite, and on
 * localhost `?product=hr` does (remembered in a cookie). Everything else is the Flooring Suite.
 */
export function productForRequest(host: string, queryProduct: string | null, cookieProduct?: string): ProductKey {
  if (host.startsWith("hr-demo")) return "hr";
  const local = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  if (!local) return "flooring";
  const requested = queryProduct ?? cookieProduct;
  return requested === "hr" ? "hr" : "flooring";
}
