import { NextResponse, type NextRequest } from "next/server";
import { isDemoMode } from "./lib/data-source";
import { PRODUCT_COOKIE, PRODUCT_HEADER, productForRequest } from "./lib/product";
import { SESSION_COOKIE } from "./lib/session/session";

/** Paths anyone may open without a demo session. */
function isPublic(pathname: string): boolean {
  return pathname === "/login" || pathname === "/design" || pathname.startsWith("/api/demo/");
}

/**
 * Resolves the product from the hostname (spec section 1) and passes it on as a request header,
 * and sends visitors without a session to the login page. The session itself is verified on
 * the server where it is read; this only checks that a cookie exists. The demo session routes
 * exist only in demo mode.
 */
export function proxy(request: NextRequest) {
  if (!isDemoMode() && request.nextUrl.pathname.startsWith("/api/demo/")) {
    return new NextResponse(null, { status: 404 });
  }
  const queryProduct = request.nextUrl.searchParams.get("product");
  const product = productForRequest(
    request.headers.get("host") ?? "",
    queryProduct,
    request.cookies.get(PRODUCT_COOKIE)?.value,
  );
  const signedIn = request.cookies.has(SESSION_COOKIE);
  const forwarded = new Headers(request.headers);
  forwarded.set(PRODUCT_HEADER, product);
  const response =
    signedIn || isPublic(request.nextUrl.pathname)
      ? NextResponse.next({ request: { headers: forwarded } })
      : NextResponse.redirect(new URL("/login", request.url));
  if (queryProduct) response.cookies.set(PRODUCT_COOKIE, product, { path: "/", sameSite: "lax" });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
