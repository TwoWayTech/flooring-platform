import { hasActiveOwner, type Role, type User } from "@workspace/shared";
import type { UserPatch } from "../contract";

/** A rule the demo refuses to break; its message is shown to the presenter as is. */
export class DemoRuleError extends Error {}

/** Seats are used by active and invited users; disabled users free their seat (spec "Settings: Users"). */
export function seatsUsed(users: readonly User[]): number {
  return users.filter((u) => u.status !== "disabled").length;
}

/** Refuses an invite once every seat on the plan is taken. */
export function assertSeatAvailable(users: readonly User[], limit: number): void {
  if (seatsUsed(users) >= limit) {
    throw new DemoRuleError(`All ${limit} seats on your plan are in use. Disable a user or ask us to raise the limit.`);
  }
}

/** Refuses a change that would leave the company without an active Owner (blueprint rule 1). */
export function assertOwnerRemains(
  users: readonly User[],
  roles: readonly Role[],
  userId: string,
  patch: UserPatch,
): void {
  const next = users.map((u) => (u.id === userId ? { ...u, ...patch } : u));
  const owners = new Set(roles.filter((r) => r.owner).map((r) => r.id));
  if (!hasActiveOwner(next, owners)) {
    throw new DemoRuleError("This is the last active Owner. Make someone else an Owner first.");
  }
}

function flatten(value: unknown, prefix = ""): Record<string, string> {
  if (value === null || typeof value !== "object") return { [prefix]: String(value) };
  return Object.entries(value).reduce<Record<string, string>>(
    (acc, [key, inner]) => ({ ...acc, ...flatten(inner, prefix ? `${prefix}.${key}` : key) }),
    {},
  );
}

/** Short before and after texts naming the fields that changed, for the audit log. */
export function diffSummary(before: unknown, after: unknown): { before: string; after: string } {
  const a = flatten(before);
  const b = flatten(after);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]);
  const shown = keys.slice(0, 3);
  const more = keys.length > shown.length ? ` and ${keys.length - shown.length} more` : "";
  return {
    before: shown.map((k) => `${k}: ${a[k] ?? "none"}`).join("; ") || "no change",
    after: shown.map((k) => `${k}: ${b[k] ?? "none"}`).join("; ") + more || "no change",
  };
}

/** Permissions added to and removed from a role, for the audit log. */
export function permissionDiff(before: readonly string[], after: readonly string[]): { before: string; after: string } {
  const removed = before.filter((k) => !after.includes(k));
  const added = after.filter((k) => !before.includes(k));
  return {
    before: removed.length ? `removed: ${removed.join(", ")}` : `${before.length} permissions`,
    after: added.length ? `added: ${added.join(", ")}` : `${after.length} permissions`,
  };
}
