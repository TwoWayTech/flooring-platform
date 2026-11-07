import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { ShellSkeleton } from "@/components/shell/shell-skeleton";
import { WorkspaceProvider } from "@/components/workspace/workspace-provider";
import { getSession } from "@/lib/session/server";

/** Every signed-in company page: verifies the session on the server, then renders the shell. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.kind === "platform") redirect("/admin");
  return (
    <WorkspaceProvider key={`${session.companyId}:${session.userId}`} session={session} fallback={<ShellSkeleton />}>
      <AppShell>{children}</AppShell>
    </WorkspaceProvider>
  );
}
