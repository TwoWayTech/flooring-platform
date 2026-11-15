"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { PlatformAdminRole } from "@workspace/shared";

/**
 * The console's admin role. Without a provider it reads `support`, the least privilege, so a page
 * rendered outside the /admin layout never offers what only the owner role may do
 * (docs/specs/platform-admin.md, part 3, "Screens", The admin's role).
 */
const PlatformRoleContext = createContext<PlatformAdminRole>("support");

/**
 * Gives the console pages the role `GET /platform/me` answered, read by the /admin layout. It only
 * decides what the screens offer; the API's guard decides every request again.
 */
export function PlatformRoleProvider({ role, children }: { role: PlatformAdminRole; children: ReactNode }) {
  return <PlatformRoleContext.Provider value={role}>{children}</PlatformRoleContext.Provider>;
}

/** The signed-in platform admin's role, `support` when no provider gives one. */
export function usePlatformRole(): PlatformAdminRole {
  return useContext(PlatformRoleContext);
}
