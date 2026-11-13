import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AcceptInvitation } from "@/features/login/account-access";
import { isDemoMode } from "@/lib/data-source";
import { requestProduct } from "@/lib/session/server";

export const metadata: Metadata = { title: "Accept your invitation" };

/** The page an invitation link lands on, with `?token=` (api mode only). */
export default async function AcceptInvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  if (isDemoMode()) redirect("/login");
  return <AcceptInvitation product={await requestProduct()} token={(await searchParams).token ?? null} />;
}
