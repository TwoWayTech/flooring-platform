import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { PRODUCT_HEADER } from "@/lib/product";
import { companyProduct } from "@/lib/api/demo/company-products";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, signSession, type DemoSession } from "@/lib/session/session";
import { featureOn } from "@workspace/shared";

const LoginBody = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("company"),
    companyId: z.enum(["summit", "keystone", "harbor"]),
    userId: z.string().min(1),
    roleKey: z.enum(["owner", "manager", "accountant", "sales", "warehouse", "installer", "hr", "employee"]),
  }),
  z.object({ kind: z.literal("platform") }),
]);

/**
 * POST /api/demo/login: records the persona the presenter picked in a signed httpOnly cookie.
 * The MFA step happens on the login page before this call (spec section 2).
 */
export async function POST(request: NextRequest) {
  const parsed = LoginBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick a company and a persona." }, { status: 400 });
  const product = request.headers.get(PRODUCT_HEADER) === "hr" ? "hr" : "flooring";
  const body = parsed.data;
  if (body.kind === "platform" && !featureOn("admin.access")) {
    return NextResponse.json({ error: "Platform admin is switched off in this demo." }, { status: 403 });
  }
  if (body.kind === "company" && companyProduct(body.companyId) !== product) {
    return NextResponse.json(
      { error: "This company uses the other product. Sign in on its own host." },
      { status: 400 },
    );
  }
  const session: DemoSession = body.kind === "company" ? { ...body, product } : { kind: "platform", product };
  const response = NextResponse.json({ session });
  response.cookies.set(SESSION_COOKIE, await signSession(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
