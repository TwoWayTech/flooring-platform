import type { ControlDb, DbHandle } from "@workspace/db";
import { numbersToWire, profileFor, type CompanySettings, type PermissionKey } from "@workspace/shared";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import type { RequestAccess } from "../src/core/access/access.service";
import type { AuditService } from "../src/core/access/audit";
import type { TenantConnectionService } from "../src/core/tenancy/tenant-connection.service";
import type { TenantContext } from "../src/core/tenancy/tenant-context";
import { SettingsService } from "../src/modules/settings/settings.service";

/** The sections `readableSections` gives the next answer: a case can name one the dispatch doesn't. */
const READABLE = vi.hoisted(() => ({ sections: [] as string[] }));

vi.mock("@workspace/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/shared")>()),
  readableSections: () => READABLE.sections,
}));

/** Summit's fixture settings, as a company's settings rows hold them. */
const SUMMIT = JSON.parse(
  readFileSync(createRequire(import.meta.url).resolve("@workspace/shared/fixtures/summit.json"), "utf8"),
) as { settings: CompanySettings };

/** A settings service over a fake company database that holds one row per group in `rows`. */
function serviceOver(rows: Record<string, unknown>): SettingsService {
  const stored = Object.entries(rows).map(([group, value]) => ({ group, value }));
  const query = { select: () => query, from: () => query, where: () => Promise.resolve(stored) };
  const tenancy = { db: async () => query } as unknown as TenantConnectionService;
  // No case reads a localization tab, so the control handle (part 2b's zone) is never used.
  return new SettingsService(tenancy, {} as AuditService, {} as DbHandle<ControlDb>);
}

/** A reader with no keys and no modules: `readableSections` is mocked, and nothing else is readable. */
const ACCESS = { permissions: new Set<PermissionKey>(), modules: [] } as unknown as RequestAccess;
const TENANT = {} as TenantContext;

/**
 * GET /settings' answer names every served section in an exhaustive switch (ADR 0059, part 2a, D19;
 * STATUS "Settings part 1 follow-ups"): a section the dispatch doesn't name can never be answered
 * under another section's name. The shared module is mocked because the real types make such a
 * section impossible.
 */
describe("GET /settings answers each served section under its own name", () => {
  it("X1 each of the six served sections is answered under its own key (part 4b adds shared costs, part 5 HR)", async () => {
    READABLE.sections = ["profile", "numbers", "payments", "expenses", "sharedCosts", "hr"];
    const { profile, numbers, payments, expenses, hr } = SUMMIT.settings;
    const sharedCosts = { rule: "fixed", fixedPct: { a: "70", b: "30" } };
    const service = serviceOver({ profile, numbers, payments, expenses, sharedCosts, hr });
    const answer = await service.answer(TENANT, ACCESS);
    expect(answer).toEqual({
      profile: profileFor(profile, ACCESS.permissions),
      numbers: numbersToWire(numbers),
      payments,
      expenses,
      sharedCosts,
      hr,
    });
  });

  it("X2 a section the dispatch doesn't name is refused, never answered as expenses", async () => {
    // Meeting settings are not served (HR is since part 5; branding since part 6, from the control row).
    READABLE.sections = ["expenses", "meetings"];
    const { expenses, meetings } = SUMMIT.settings;
    const service = serviceOver({ expenses, meetings });
    await expect(service.answer(TENANT, ACCESS)).rejects.toThrow('GET /settings has no answer for "meetings".');
  });
});
