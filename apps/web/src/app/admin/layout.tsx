import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { PlatformShell } from "@/features/admin/platform-shell";
import { getPlatformGate } from "@/lib/session/server";
import { featureOn } from "@workspace/shared";

export const metadata: Metadata = { title: { default: "Platform admin", template: "%s | Platform admin" } };

/**
 * Platform admin pages need a platform admin and the admin.access feature (docs/specs/platform-admin.md,
 * "Screens", Layout). In the demo that is the "Platform admin (you)" card; in api mode the API's
 * GET /platform/me decides. Signed out or MFA still to set up goes to /login, anyone else to /.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const gate = await getPlatformGate();
  if (gate.kind === "signed_out") redirect("/login");
  if (gate.kind === "not_admin") redirect("/");
  if (gate.kind === "off" || !featureOn("admin.access")) notFound();
  return <PlatformShell>{children}</PlatformShell>;
}
