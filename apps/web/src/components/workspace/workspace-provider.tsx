"use client";

import { useTheme } from "next-themes";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BrandStyle } from "@workspace/ui/components/brand-style";
import { NumberSettingsProvider } from "@workspace/ui/components/number-settings";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { QueryFallback } from "@/components/query-fallback";
import { viewerAccess } from "@/lib/access";
import type { CompanySession } from "@/lib/session/session";
import { PRODUCTS } from "@/products";
import { WorkspaceContext, type Workspace } from "./workspace-context";

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
 * user, roles and effective access. Branding and number format apply to everything below.
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
    const stored = readViewAs(session.companyId);
    void api.openCompany(session.companyId, { userId: session.userId, viewAsRoleId: stored }).then(() => {
      setViewAsState(stored);
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
      const [company, settings, roles, users] = await Promise.all([
        client.getCompany(),
        client.getSettings(),
        client.list("roles"),
        client.list("users"),
      ]);
      return { company, settings, roles, users };
    },
    [session.companyId],
    // The shell keeps its company and roles when a later re-read fails; the page shows the error.
    { keepDataOnError: true },
  );
  useCompanyDefaultTheme(query.data?.settings.branding.defaultTheme);

  const workspace = useMemo<Workspace | null>(() => {
    if (query.status !== "ready") return null;
    const { company, settings, roles, users } = query.data;
    const user = users.find((u) => u.id === session.userId);
    if (!user) return null;
    const viewAsRole = roles.find((r) => r.id === viewAs) ?? null;
    return {
      session,
      product: PRODUCTS[session.product],
      company,
      settings,
      user,
      roles,
      access: viewerAccess(company, roles, user, viewAsRole?.id ?? null),
      viewAsRole,
      setViewAs,
    };
  }, [query, session, viewAs, setViewAs]);

  if (query.status === "error") {
    return <QueryFallback query={query} className="m-4 lg:m-8" label="Loading your workspace" />;
  }
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
