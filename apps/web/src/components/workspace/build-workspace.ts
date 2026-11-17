import type { Company, CompanySettings } from "@workspace/shared";
import { viewerAccess } from "@/lib/access";
import type { WorkspaceFacts } from "@/lib/api/contract";
import type { CompanySession } from "@/lib/session/session";
import { viewAsRoleFor } from "@/lib/view-as";
import { PRODUCTS } from "@/products";
import type { Workspace } from "./workspace-context";

/** What the shell read: the facts (`getWorkspace`), DemoStore's company (`getCompany`) and the settings. */
export interface WorkspaceRead {
  facts: WorkspaceFacts;
  base: Company;
  settings: CompanySettings;
}

/** The session and View as choice the provider holds. */
export interface WorkspaceChoice {
  session: CompanySession;
  viewAs: string | null;
  setViewAs: (roleId: string | null) => void;
}

/**
 * The workspace every screen reads (ADR 0051, "GET /company"). The facts' name, place, modules,
 * ceiling and branches lie over DemoStore's company, which keeps the id, product, plan, status and
 * limits until Settings and billing move. The access is the facts' own (the guard's in api mode,
 * never worked out again; D3) unless the demo's View as applies (D16); a View as access is worked
 * out against DemoStore's own company, whose ceiling is never trimmed (D4).
 */
export function buildWorkspace(read: WorkspaceRead, { session, viewAs, setViewAs }: WorkspaceChoice): Workspace {
  const { facts, base, settings } = read;
  const viewAsRole = viewAsRoleFor(viewAs, facts.user, facts.roles);
  return {
    session,
    product: PRODUCTS[session.product],
    company: { ...base, ...facts.company },
    settings,
    user: facts.user,
    roles: facts.roles,
    access: viewAsRole ? viewerAccess(base, facts.roles, facts.user, viewAsRole.id) : facts.access,
    viewAsRole,
    setViewAs,
  };
}
