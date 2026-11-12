import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ApiSignIn } from "@/features/login/api-sign-in";
import { LoginScreen } from "@/features/login/login-screen";
import { isDemoMode } from "@/lib/data-source";
import { getSession, requestProduct } from "@/lib/session/server";

export const metadata: Metadata = { title: "Sign in" };

/**
 * The login page, branded for this host's product. Signed-in visitors go straight to their home.
 * The persona picker is the demo's sign-in; with the real API the page shows ApiSignIn instead.
 */
export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect(session.kind === "platform" ? "/admin" : "/");
  const product = await requestProduct();
  return isDemoMode() ? <LoginScreen product={product} /> : <ApiSignIn product={product} />;
}
