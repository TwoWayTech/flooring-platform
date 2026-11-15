import type { Metadata } from "next";
import { PlatformAuditPage } from "@/features/admin/platform-audit-page";

export const metadata: Metadata = { title: "Audit log" };

/** Platform admin: the platform audit log (docs/specs/platform-admin.md, part 3). The layout gates it. */
export default function Page() {
  return <PlatformAuditPage />;
}
