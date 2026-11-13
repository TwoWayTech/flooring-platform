import { encodeMemberRoles, US_STATES, type ProductKey } from "@workspace/shared";
import type { ControlDb } from "../client";
import {
  account,
  countryPacks,
  member,
  organization,
  packStates,
  planLimits,
  planModules,
  plans,
  products,
  tenantBranding,
  tenantPermissionCeiling,
  tenantProducts,
  tenants,
  tenantSubscriptions,
  user,
} from "../control";
import { seedId, type DemoCompany } from "./fixtures";

const PRODUCT_NAMES: Record<ProductKey, string> = { flooring: "Flooring Suite", hr: "HR Suite" };

/** The tenant id of a seeded demo company. */
export function seededTenantId(companyId: string): string {
  return seedId(`tenant:${companyId}`);
}

/** The control-database user id of a seeded demo user. */
export function seededUserId(fixtureUserId: string): string {
  return seedId(`user:${fixtureUserId}`);
}

async function seedReferenceData(tx: ControlDb): Promise<void> {
  await tx
    .insert(products)
    .values(
      Object.entries(PRODUCT_NAMES).map(([key, name]) => ({
        id: seedId(`product:${key}`),
        key: key as ProductKey,
        name,
      })),
    )
    .onConflictDoNothing();
  const packId = seedId("pack:US");
  await tx
    .insert(countryPacks)
    .values({ id: packId, code: "US", name: "United States", currency: "USD" })
    .onConflictDoNothing();
  await tx
    .insert(packStates)
    .values(US_STATES.map(([code, name]) => ({ id: seedId(`pack:US:${code}`), packId, code, name })))
    .onConflictDoNothing();
}

async function seedPlan(tx: ControlDb, { company }: DemoCompany): Promise<string> {
  const planKey = company.plan.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const planId = seedId(`plan:${planKey}`);
  // Prices are open (blueprint p53, open questions): zero until the owner sets them.
  await tx
    .insert(plans)
    .values({
      id: planId,
      key: planKey,
      name: company.plan,
      productId: seedId(`product:${company.product}`),
      monthlyPrice: "0",
      yearlyPrice: "0",
    })
    .onConflictDoNothing();
  await tx
    .insert(planModules)
    .values(
      company.modules
        .filter((module) => module !== "platform")
        .map((module) => ({ id: seedId(`plan:${planKey}:${module}`), planId, module })),
    )
    .onConflictDoNothing();
  await tx
    .insert(planLimits)
    .values({
      id: seedId(`plan:${planKey}:limits`),
      planId,
      maxUsers: company.userLimit,
      maxBranches: company.branchLimit,
    })
    .onConflictDoNothing();
  return planId;
}

async function seedTenant(tx: ControlDb, demo: DemoCompany, planId: string): Promise<void> {
  const { company, fixtures } = demo;
  const tenantId = seededTenantId(company.id);
  const branding = fixtures.settings.branding;
  await tx
    .insert(tenants)
    .values({
      id: tenantId,
      slug: company.id,
      legalName: fixtures.settings.profile.legalName,
      name: company.name,
      city: company.city,
      state: company.state,
      status: company.status,
      timeZone: fixtures.settings.localization.region.timeZone,
    })
    .onConflictDoNothing();
  await tx
    .insert(tenantProducts)
    .values({ id: seedId(`tenant:${company.id}:product`), tenantId, productId: seedId(`product:${company.product}`) })
    .onConflictDoNothing();
  const periodStart = new Date();
  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + 1);
  await tx
    .insert(tenantSubscriptions)
    .values({
      id: seedId(`tenant:${company.id}:subscription`),
      tenantId,
      planId,
      interval: "monthly",
      price: "0",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      status: company.status === "trial" ? "trial" : "active",
    })
    .onConflictDoNothing();
  await tx
    .insert(tenantPermissionCeiling)
    .values(
      company.ceiling.map((key) => ({
        id: seedId(`ceiling:${company.id}:${key}`),
        tenantId,
        permissionKey: key,
        allowed: true,
      })),
    )
    .onConflictDoNothing();
  await tx
    .insert(tenantBranding)
    .values({
      id: seedId(`tenant:${company.id}:branding`),
      tenantId,
      displayName: branding.displayName,
      monogram: branding.monogram,
      brandColor: branding.brandColor,
      pattern: branding.pattern,
      defaultTheme: branding.defaultTheme,
    })
    .onConflictDoNothing();
}

/**
 * The company's people as Better Auth users and organization members. When a password hash is
 * given, each user also gets a Better Auth "credential" account with it, so they can sign in
 * locally (accounts are invite-only, ADR 0029). No MFA secrets are seeded.
 */
async function seedPeople(
  tx: ControlDb,
  { company, fixtures }: DemoCompany,
  passwordHash: string | undefined,
): Promise<void> {
  const tenantId = seededTenantId(company.id);
  const now = new Date();
  await tx
    .insert(organization)
    .values({ id: tenantId, name: company.name, slug: company.id, createdAt: now })
    .onConflictDoNothing();
  const roleKeyById = new Map(fixtures.roles.map((role) => [role.id, role.key]));
  for (const person of fixtures.users) {
    const userId = seededUserId(person.id);
    await tx
      .insert(user)
      .values({ id: userId, name: person.name, email: person.email, emailVerified: true })
      .onConflictDoNothing();
    // member.role holds the person's role keys, which sign-in reads to require MFA (ADR 0029,
    // part 2). Re-seeding refreshes it, so databases seeded before part 2 get the keys too.
    const role = encodeMemberRoles(person.roleIds.flatMap((roleId) => roleKeyById.get(roleId) ?? []));
    await tx
      .insert(member)
      .values({ id: seedId(`member:${person.id}`), organizationId: tenantId, userId, role, createdAt: now })
      .onConflictDoUpdate({ target: member.id, set: { role } });
    if (passwordHash) {
      await tx
        .insert(account)
        .values({
          id: seedId(`account:${person.id}`),
          accountId: userId,
          providerId: "credential",
          userId,
          password: passwordHash,
          updatedAt: now,
        })
        .onConflictDoNothing();
    }
  }
}

/**
 * Seeds the control-database side of one demo company: products, plan, tenant, branding, ceiling
 * and people. `passwordHash` (a Better Auth hash) gives every seeded user a password.
 */
export async function seedControl(control: ControlDb, demo: DemoCompany, passwordHash?: string): Promise<string> {
  await control.transaction(async (tx) => {
    await seedReferenceData(tx);
    const planId = await seedPlan(tx, demo);
    await seedTenant(tx, demo, planId);
    await seedPeople(tx, demo, passwordHash);
  });
  return seededTenantId(demo.company.id);
}
