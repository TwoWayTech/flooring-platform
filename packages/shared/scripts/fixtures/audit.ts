import { addDays } from "../../src/dates";
import type { AuditEntry, User } from "../../src/types";
import type { GenContext } from "./context";

type Seed = Omit<AuditEntry, "id" | "at" | "actorName" | "actorRole"> & { daysAgo: number; byPlatform?: boolean };

/** Earlier history so the audit log is not empty on first open (blueprint "Audit log"). */
function history(users: readonly User[], brandColor: string): Seed[] {
  const invited = users.find((u) => u.status === "invited");
  const disabled = users.find((u) => u.status === "disabled");
  const entries: Seed[] = [
    {
      daysAgo: 41,
      category: "settings",
      action: "Changed number format",
      target: "Unit cost decimals",
      before: "2",
      after: "4",
    },
    {
      daysAgo: 33,
      category: "settings",
      action: "Changed brand color",
      target: "Branding",
      before: "#2A7F73",
      after: brandColor,
    },
    {
      daysAgo: 27,
      category: "role",
      action: "Changed role permissions",
      target: "Role: Manager",
      before: "settings.users.manage",
      after: "(removed)",
    },
    {
      daysAgo: 19,
      category: "ceiling",
      action: "Removed from plan",
      target: "Permission ceiling",
      before: "allowed",
      after: "not included",
      byPlatform: true,
    },
    {
      daysAgo: 12,
      category: "security",
      action: "Reset MFA",
      target: users[4]?.name ?? "User",
      before: "enrolled",
      after: "not enrolled",
    },
    {
      daysAgo: 6,
      category: "settings",
      action: "Updated tax rule",
      target: "Sales tax: example rules",
      before: "version 1",
      after: "version 1 (confirmed)",
    },
  ];
  if (disabled)
    entries.push({
      daysAgo: 52,
      category: "user",
      action: "Disabled user",
      target: disabled.name,
      before: "active",
      after: "disabled",
    });
  if (invited)
    entries.push({
      daysAgo: 2,
      category: "user",
      action: "Invited user",
      target: invited.name,
      before: null,
      after: invited.email,
    });
  return entries;
}

/** Seeded audit entries, newest first, made by the Owner or by the platform admin. */
export function buildAudit(ctx: GenContext, users: readonly User[]): AuditEntry[] {
  const owner = users[0]!;
  return history(users, ctx.company.brandColor)
    .sort((a, b) => a.daysAgo - b.daysAgo)
    .map(({ daysAgo, byPlatform, ...entry }) => ({
      id: ctx.id("aud"),
      at: `${addDays(ctx.anchor, -daysAgo)}T${String(ctx.rng.int(8, 17)).padStart(2, "0")}:${String(ctx.rng.int(0, 59)).padStart(2, "0")}`,
      actorName: byPlatform ? "Platform admin" : owner.name,
      actorRole: byPlatform ? "Super-admin" : "Owner",
      ...entry,
    }));
}
