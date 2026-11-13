import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ResetPassword } from "@/features/login/account-access";
import { isDemoMode } from "@/lib/data-source";
import { requestProduct } from "@/lib/session/server";

export const metadata: Metadata = { title: "Choose a new password" };

/** The page a reset link lands on, with `?token=` or `?error=INVALID_TOKEN` (api mode only). */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  if (isDemoMode()) redirect("/login");
  return <ResetPassword product={await requestProduct()} token={(await searchParams).token ?? null} />;
}
