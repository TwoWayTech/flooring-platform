import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginScreen } from "@/features/login/login-screen";
import { getSession, requestProduct } from "@/lib/session/server";

export const metadata: Metadata = { title: "Sign in" };

/** The login page, branded for this host's product. Signed-in visitors go straight to their home. */
export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect(session.kind === "platform" ? "/admin" : "/");
  return <LoginScreen product={await requestProduct()} />;
}
