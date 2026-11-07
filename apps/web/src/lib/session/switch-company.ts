import type { Company } from "@workspace/shared";
import { api } from "@/lib/api";
import { signIn } from "./client";
import type { CompanySession } from "./session";

/**
 * Signs the presenter in as the same persona in another company, or as its Owner when nobody
 * there holds the role. The caller then refreshes so the shell picks up the new branding.
 */
export async function signInToCompany(target: Company, session: CompanySession): Promise<void> {
  const { users, roles } = await api.listCompanyDirectory(target.id);
  const role = roles.find((r) => r.key === session.roleKey) ?? roles.find((r) => r.owner)!;
  const persona = users.find((u) => u.status === "active" && u.roleIds.includes(role.id)) ?? users[0]!;
  await signIn({ kind: "company", companyId: target.id, userId: persona.id, roleKey: role.key });
}
