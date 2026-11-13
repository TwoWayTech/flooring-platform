import { createHash, randomBytes } from "node:crypto";

/** An invitation link works for 7 days and once (docs/specs/settings-users-access.md). */
export const INVITATION_DAYS = 7;

/** The longest password accepted; Better Auth's default maximum. */
export const MAX_PASSWORD_LENGTH = 128;

/** A new invitation token: 32 random bytes, URL-safe. Only its hash is stored. */
export function newInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The SHA-256 of a token, as `user_invitations.token_hash` stores it. */
export function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Whether a host matches an AUTH_ALLOWED_HOSTS entry; `*` stands for any run of characters (development only). */
function hostAllowed(host: string, allowed: readonly string[]): boolean {
  return allowed.some((pattern) => {
    const regex = new RegExp(`^${pattern.split("*").map(escapeRegex).join(".*")}$`, "i");
    return regex.test(host);
  });
}

function escapeRegex(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The web origin an emailed link points to: the host the admin is using, when it is one of
 * AUTH_ALLOWED_HOSTS, else the first exact allowed host. A forged host header can therefore never
 * send a link to someone else's site (the reason ADR 0029 forbids wildcards in production).
 */
export function linkOrigin(
  forwardedHost: string | undefined,
  allowedHosts: readonly string[],
  secure: boolean,
): string | null {
  const requested = forwardedHost?.split(",")[0]?.trim();
  const host =
    requested && hostAllowed(requested, allowedHosts) ? requested : allowedHosts.find((entry) => !entry.includes("*"));
  return host ? `${secure ? "https" : "http"}://${host}` : null;
}

/**
 * Seats in use (spec rule 14): active and invited users count, disabled users free a seat. Null
 * limit means none: a trial has no plan yet (plan prices are still open).
 */
export function seatProblem(statuses: readonly string[], limit: number | null): string | null {
  if (limit === null) return null;
  const used = statuses.filter((status) => status !== "disabled").length;
  return used >= limit
    ? `All ${limit} seats on your plan are in use. Disable a user or ask us to raise the limit.`
    : null;
}
