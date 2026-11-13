import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ForgotPassword } from "@/features/login/account-access";
import { isDemoMode } from "@/lib/data-source";
import { requestProduct } from "@/lib/session/server";

export const metadata: Metadata = { title: "Reset your password" };

/** Forgot password (api mode only; the demo signs in by persona). */
export default async function ForgotPasswordPage() {
  if (isDemoMode()) redirect("/login");
  return <ForgotPassword product={await requestProduct()} />;
}
