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
 * The admin's role goes down to the pages (part 3), which then offer only what it may do; the
 * API's guard still decides every request. With the switch off, every /admin page is not found,
 * the audit log and the Support tab included.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const gate = await getPlatformGate();
  if (gate.kind === "signed_out") redirect("/login");
  if (gate.kind === "not_admin") redirect("/");
  if (gate.kind === "off" || !featureOn("admin.access")) notFound();
  return <PlatformShell role={gate.role}>{children}</PlatformShell>;
}
