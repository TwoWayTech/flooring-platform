import type { ProductKey } from "@workspace/shared";

export { PRODUCT_HEADER } from "@workspace/shared";

/**
 * Cookie that remembers `?product=hr` on localhost, where there is no HR hostname. The demo keeps
 * its own name; the real product uses a neutral one (click-through #69).
 */
export function productCookie(demo: boolean): string {
  return demo ? "demo_product" : "product_choice";
}

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

/** What the proxy reads for one request: the product, and whether to remember it in the cookie. */
export interface ProductChoice {
  product: ProductKey;
  remember: boolean;
}

/**
 * The product for a request and whether the cookie is (re)written. The demo remembers a
 * `?product=` until another one is given. The real product decides the sign-in page by the host
 * and its own query only, so a plain /login after `/login?product=hr` is the Flooring Suite again,
 * and records that choice for the pages after sign-in (click-through #69).
 */
export function productChoice(options: {
  demo: boolean;
  host: string;
  pathname: string;
  queryProduct: string | null;
  cookieProduct?: string;
}): ProductChoice {
  const { demo, host, pathname, queryProduct, cookieProduct } = options;
  const signIn = !demo && pathname === "/login";
  const product = productForRequest(host, queryProduct, signIn ? undefined : cookieProduct);
  return { product, remember: queryProduct !== null || (signIn && cookieProduct !== product) };
}
