/**
 * Which company a new session opens (decided with the owner on 2026-11-12, ADR 0029; blueprint
 * p12 "the session records the active company", p16 "the subdomain picks the company").
 */

/** The outcome of a sign-in: open one company, ask the user to choose, or refuse the sign-in. */
export type CompanyPick =
  { kind: "open"; companyId: string } | { kind: "choose" } | { kind: "refuse"; reason: "not_a_member" | "no_company" };

/**
 * The company slug a host names, if any: the first label of a host with at least three labels,
 * such as `summit` in `summit.flooringsuite.com`. Localhost and IP addresses name no company.
 */
export function hostCompanySlug(host: string | undefined): string | undefined {
  if (!host) return undefined;
  const hostname = host.replace(/:\d+$/, "").toLowerCase();
  if (hostname === "localhost" || /^[\d.]+$/.test(hostname) || hostname.includes(":")) return undefined;
  const labels = hostname.split(".");
  return labels.length >= 3 ? labels[0] : undefined;
}

/**
 * The rule: a host that names a company opens it for its members and refuses everyone else.
 * Otherwise a user with one company opens it, a user with several chooses after signing in, and
 * a user with none is refused (platform admins sign in on their own host, later).
 *
 * @param hostCompanyId The company the host's subdomain names, or null when it names none.
 * @param memberIds The ids of the companies the user is a member of.
 */
export function pickCompany(hostCompanyId: string | null, memberIds: readonly string[]): CompanyPick {
  if (hostCompanyId) {
    return memberIds.includes(hostCompanyId)
      ? { kind: "open", companyId: hostCompanyId }
      : { kind: "refuse", reason: "not_a_member" };
  }
  if (memberIds.length === 1) return { kind: "open", companyId: memberIds[0] };
  return memberIds.length === 0 ? { kind: "refuse", reason: "no_company" } : { kind: "choose" };
}
