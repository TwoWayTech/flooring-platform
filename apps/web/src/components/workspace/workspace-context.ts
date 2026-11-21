"use client";

import { createContext, useContext } from "react";
import type { Access, Company, CompanySettings, PermissionKey, Role, User } from "@workspace/shared";
import type { CompanySession } from "@/lib/session/session";
import type { ProductConfig } from "@/products";

/** Everything a screen needs to know about who is signed in and what they may do. */
export interface Workspace {
  session: CompanySession;
  product: ProductConfig;
  company: Company;
  settings: CompanySettings;
  user: User;
  roles: Role[];
  /**
   * Effective access: the user's roles, or the viewed-as role (demo only), ∩ ceiling ∩ modules
   * (CLAUDE.md rule 4). On the API it is the guard's own, from GET /company (ADR 0051).
   */
  access: Access;
  viewAsRole: Role | null;
  /** The zone moments are shown in, from GET /company (ADR 0064); null when Intl does not know it. */
  timeZone: string | null;
  setViewAs: (roleId: string | null) => void;
}

export const WorkspaceContext = createContext<Workspace | null>(null);

/** The signed-in workspace. Only valid inside the app shell. */
export function useWorkspace(): Workspace {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error("useWorkspace must be used inside WorkspaceProvider.");
  return workspace;
}

/** Permission checks for the current viewer: `can("sales.margin.view_sensitive")`. */
export function useCan(): (key: PermissionKey) => boolean {
  const { access } = useWorkspace();
  return (key) => access.permissions.has(key);
}
