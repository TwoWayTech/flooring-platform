"use client";

import { useTheme } from "next-themes";
import { toast } from "sonner";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BrandStyle } from "@workspace/ui/components/brand-style";
import { NumberSettingsProvider } from "@workspace/ui/components/number-settings";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import type { CompanySession } from "@/lib/session/session";
import { viewAsOffered } from "@/lib/view-as";
import { buildWorkspace } from "./build-workspace";
import { openWorkspace } from "./open-workspace";
import { WorkspaceContext, type Workspace } from "./workspace-context";
import { WorkspaceRefused } from "./workspace-refused";

const viewAsKey = (companyId: string) => `fp-view-as:${companyId}`;

function readViewAs(companyId: string): string | null {
  try {
    return sessionStorage.getItem(viewAsKey(companyId));
  } catch {
    return null;
  }
}

function storeViewAs(companyId: string, roleId: string | null) {
  try {
    if (roleId) sessionStorage.setItem(viewAsKey(companyId), roleId);
    else sessionStorage.removeItem(viewAsKey(companyId));
  } catch {
    // Without storage the choice lasts until reload.
  }
}

/**
 * Opens the signed-in company in the ApiClient, then provides the workspace: company, settings,
 * user, roles and effective access (`getWorkspace`, GET /company in api mode; ADR 0051, "GET
 * /company"). A stored View as applies only for someone who may use it, and one that doesn't is
 * cleared (D16). Branding and number format apply to everything below.
 */
export function WorkspaceProvider({
  session,
  children,
  fallback,
}: {
  session: CompanySession;
  children: ReactNode;
  fallback: ReactNode;
}) {
  const [opened, setOpened] = useState(false);
  const [viewAs, setViewAsState] = useState<string | null>(null);

  useEffect(() => {
    const stored = viewAsOffered() ? readViewAs(session.companyId) : null;
    void openWorkspace(api, { companyId: session.companyId, userId: session.userId }, stored).then((applied) => {
      // A stored choice that doesn't apply to this person is cleared, so it never reaches the next one.
      if (stored !== applied) storeViewAs(session.companyId, applied);
      for (const notice of api.takeNotices()) toast.info(notice);
      setViewAsState(applied);
      setOpened(true);
    });
  }, [session.companyId, session.userId]);

  if (!opened) return <>{fallback}</>;
  return (
    <WorkspaceData
      session={session}
      viewAs={viewAs}
      setViewAs={(roleId) => {
        storeViewAs(session.companyId, roleId);
        setViewAsState(roleId);
        api.setViewer({ userId: session.userId, viewAsRoleId: roleId });
      }}
      fallback={fallback}
    >
      {children}
    </WorkspaceData>
  );
}

interface WorkspaceDataProps {
  session: CompanySession;
  viewAs: string | null;
  setViewAs: (roleId: string | null) => void;
  children: ReactNode;
  fallback: ReactNode;
}

function WorkspaceData({ session, viewAs, setViewAs, children, fallback }: WorkspaceDataProps) {
  const query = useApiQuery(
    async (client) => {
      const [facts, base, settings] = await Promise.all([
        client.getWorkspace(),
        client.getCompany(),
        client.getSettings(),
      ]);
      return { facts, base, settings };
    },
    [session.companyId],
    // The shell keeps its company and roles when a later re-read fails; the page shows the error.
    { keepDataOnError: true },
  );
  useCompanyDefaultTheme(query.data?.settings.branding.defaultTheme);

  const workspace = useMemo<Workspace | null>(
    () => (query.status === "ready" ? buildWorkspace(query.data, { session, viewAs, setViewAs }) : null),
    [query, session, viewAs, setViewAs],
  );

  // With keepDataOnError this is only a first read that failed: a full page with Sign out (D17).
  if (query.status === "error") return <WorkspaceRefused error={query.error} onRetry={query.retry} />;
  if (!workspace) return <>{fallback}</>;
  return (
    <WorkspaceContext.Provider value={workspace}>
      <BrandStyle color={workspace.settings.branding.brandColor} />
      <NumberSettingsProvider settings={workspace.settings.numbers}>{children}</NumberSettingsProvider>
    </WorkspaceContext.Provider>
  );
}

/** Applies the company's default theme until the person picks one themselves (Settings: Branding). */
function useCompanyDefaultTheme(defaultTheme: "light" | "dark" | "system" | undefined) {
  const { setTheme } = useTheme();
  useEffect(() => {
    if (!defaultTheme) return;
    try {
      if (!localStorage.getItem("theme")) setTheme(defaultTheme);
    } catch {
      setTheme(defaultTheme);
    }
  }, [defaultTheme, setTheme]);
}
