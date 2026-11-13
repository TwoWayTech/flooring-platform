import { NextResponse, type NextRequest } from "next/server";
import { isDemoMode } from "./lib/data-source";
import { PRODUCT_COOKIE, PRODUCT_HEADER, productForRequest } from "./lib/product";
import { API_PROXY_PATH, AUTH_BASE_PATH, AUTH_SESSION_COOKIES } from "./lib/session/auth-cookie";
import { withAuthProxyHeaders } from "./lib/session/auth-proxy";
import { SESSION_COOKIE } from "./lib/session/session";

/**
 * Paths anyone may open without a session. In api mode that includes the proxied API, which
 * answers 401 itself (sign-in, verification links and the session check go through it).
 */
function isPublic(pathname: string): boolean {
  if (pathname === "/login" || pathname === "/design") return true;
  if (isDemoMode()) return pathname.startsWith("/api/demo/");
  return pathname.startsWith(`${AUTH_BASE_PATH}/`) || pathname.startsWith(`${API_PROXY_PATH}/`);
}

/** Whether the request carries a session cookie; the server verifies it where the session is read. */
function hasSessionCookie(request: NextRequest): boolean {
  if (isDemoMode()) return request.cookies.has(SESSION_COOKIE);
  return AUTH_SESSION_COOKIES.some((name) => request.cookies.has(name));
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
  const signedIn = hasSessionCookie(request);
  const forwarded = withAuthProxyHeaders(
    new Headers(request.headers),
    request.nextUrl.pathname,
    process.env.AUTH_PROXY_SECRET,
  );
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
