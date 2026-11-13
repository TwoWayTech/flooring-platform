import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ProductKey } from "@workspace/shared";
import { ApiSignIn, type SignInStage } from "@/features/login/api-sign-in";
import { LoginScreen } from "@/features/login/login-screen";
import { isDemoMode } from "@/lib/data-source";
import { toCompanySession, type SessionContext } from "@/lib/session/api-context";
import { getSession, getSessionContext, requestProduct } from "@/lib/session/server";

export const metadata: Metadata = { title: "Sign in" };

/** Where a visitor stands on the real login page, or "ready" when their workspace can open. */
async function apiStage(context: SessionContext | null, product: ProductKey): Promise<SignInStage | "ready"> {
  if (!context) return { kind: "sign-in" };
  if (!context.company) return { kind: "choose", companies: context.companies };
  return (await toCompanySession(context, product)) ? "ready" : { kind: "no-profile" };
}

/**
 * The login page, branded for this host's product. Signed-in visitors go straight to their home.
 * The persona picker is the demo's sign-in; with the real API the page shows the email and
 * password sign-in, or the company chooser for a session that has no company open yet.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ verified?: string }> }) {
  const product = await requestProduct();
  if (isDemoMode()) {
    const session = await getSession();
    if (session) redirect(session.kind === "platform" ? "/admin" : "/");
    return <LoginScreen product={product} />;
  }
  const stage = await apiStage(await getSessionContext(), product);
  if (stage === "ready") redirect("/");
  return <ApiSignIn product={product} initial={stage} verified={(await searchParams).verified === "1"} />;
}
