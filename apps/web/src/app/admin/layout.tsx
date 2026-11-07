import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { PlatformShell } from "@/features/admin/platform-shell";
import { getSession } from "@/lib/session/server";

export const metadata: Metadata = { title: { default: "Platform admin", template: "%s | Platform admin" } };

/** Super-admin pages need the platform session (the "Platform admin (you)" login card). */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.kind !== "platform") redirect("/");
  return <PlatformShell>{children}</PlatformShell>;
}
