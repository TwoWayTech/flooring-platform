import type { ApiClient } from "@/lib/api/contract";
import type { CompanySession } from "@/lib/session/session";
import { viewAsOffered, viewAsRoleFor } from "@/lib/view-as";

/**
 * Opens the company with no View as, then applies a stored View as only for someone who may use it
 * (ADR 0051, "GET /company", D16), so DemoStore never acts as a stored role for anyone else. In api
 * mode View as is not offered, so the facts are not read here. Returns the role id applied, or null.
 */
export async function openWorkspace(
  client: Pick<ApiClient, "openCompany" | "getWorkspace" | "setViewer">,
  session: Pick<CompanySession, "companyId" | "userId">,
  stored: string | null,
): Promise<string | null> {
  await client.openCompany(session.companyId, { userId: session.userId, viewAsRoleId: null });
  if (!stored || !viewAsOffered()) return null;
  const facts = await client.getWorkspace().catch(() => null);
  const role = facts ? viewAsRoleFor(stored, facts.user, facts.roles) : null;
  if (role) client.setViewer({ userId: session.userId, viewAsRoleId: role.id });
  return role?.id ?? null;
}
