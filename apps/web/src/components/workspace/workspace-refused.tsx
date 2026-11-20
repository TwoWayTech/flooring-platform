"use client";

import { useEffect, useRef } from "react";
import { ShieldAlert } from "lucide-react";
import { BlockedPanel, FullPageCard, UnavailablePanel } from "@/features/standing/company-unavailable";
import { useSessionActions } from "@/lib/session/use-session-actions";
import { workspaceRefusal } from "./workspace-refusal";

/**
 * The full page a refused first read of the workspace shows instead of the shell (ADR 0051, "GET
 * /company", D17): the company-unavailable panel for a standing refusal, otherwise "Your workspace
 * could not open" with the API's own words. Both offer Try again (the read again) and Sign out, so a
 * disabled member or one still to set up two-step sign-in is never stuck: without a shell there is
 * no other way out, and /login sends a signed-in person back here. Nothing beyond the API's own
 * refusal is shown. The title takes focus.
 */
export function WorkspaceRefused({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { signOut } = useSessionActions();
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus();
  }, []);
  const refusal = workspaceRefusal(error);
  const panel = { titleAs: "h1", titleRef: title, pending: false, onRetry, onSignOut: () => void signOut() } as const;
  return (
    <FullPageCard>
      {refusal.kind === "standing" ? (
        <UnavailablePanel state={refusal.state} {...panel} />
      ) : (
        <BlockedPanel
          icon={ShieldAlert}
          tone="text-danger-ink bg-danger/12"
          title="Your workspace could not open"
          body={refusal.message}
          {...panel}
        />
      )}
    </FullPageCard>
  );
}
