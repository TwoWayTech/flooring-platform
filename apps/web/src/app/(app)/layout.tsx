import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { blocksCompany } from "@workspace/shared";
import { AppShell } from "@/components/shell/app-shell";
import { ShellSkeleton } from "@/components/shell/shell-skeleton";
import { WorkspaceProvider } from "@/components/workspace/workspace-provider";
import { CompanyUnavailable } from "@/features/standing/company-unavailable";
import { StandingGate } from "@/features/standing/standing-gate";
import { getServerStanding, getSession } from "@/lib/session/server";

/**
 * Every signed-in company page: verifies the session on the server, asks where the company stands
 * (docs/specs/platform-admin.md, part 4, "On a full page load"), then renders the shell. A company
 * in maintenance, with an unavailable database or locked gets only its full-page screen: no shell,
 * menu or workspace.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.kind === "platform") redirect("/admin");
  const standing = await getServerStanding();
  if (standing && blocksCompany(standing.state)) return <CompanyUnavailable state={standing.state} />;
  return (
    <WorkspaceProvider key={`${session.companyId}:${session.userId}`} session={session} fallback={<ShellSkeleton />}>
      <StandingGate initial={standing}>
        <AppShell>{children}</AppShell>
      </StandingGate>
    </WorkspaceProvider>
  );
}
