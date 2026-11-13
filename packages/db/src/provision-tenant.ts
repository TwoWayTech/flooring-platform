import { encodeMemberRoles, PRODUCT_DEFAULT_BRANDING, type ProductKey } from "@workspace/shared";
import type { DatabaseProvisioner } from "@workspace/providers";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { openCompanyDb, type ControlDb } from "./client";
import { productPermissions, seedCompanyFoundation } from "./company-foundation";
import {
  member,
  organization,
  products,
  tenantBranding,
  tenantDatabases,
  tenantPermissionCeiling,
  tenantProducts,
  tenants,
  user,
} from "./control";
import { provisionCompany } from "./provision";
import { ensureReferenceData } from "./seed/control";

/**
 * Subdomains the platform keeps for itself, so no company can take the host of a product, the API
 * or the admin console (PR #2 review). A company slug is also its subdomain and part of its
 * database name, which is why it is lowercase letters and digits only.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "app",
  "auth",
  "demo",
  "docs",
  "flooring",
  "help",
  "hr",
  "login",
  "mail",
  "status",
  "support",
  "www",
]);

const SLUG = /^[a-z][a-z0-9]{1,30}$/;

/** The company a new tenant is created for, and its first owner. */
export interface NewCompany {
  slug: string;
  name: string;
  legalName: string;
  /** Two-letter US state; it picks the country-pack rules (CLAUDE.md rule 12). */
  state: string;
  city?: string;
  /** IANA time zone, such as `America/Chicago`. */
  timeZone: string;
  products: readonly ProductKey[];
  owner: { name: string; email: string };
  /**
   * Allows making an existing user the owner. Without it, an email that already has an account is
   * refused, so a typo or a false request cannot hand someone else's account a new company.
   */
  reuseExistingOwner?: boolean;
}

/** What provisioning made. */
export interface ProvisionedTenant {
  tenantId: string;
  ownerUserId: string;
  /** True when a run that stopped earlier was finished, rather than a new company created. */
  resumed: boolean;
}

/** Why a company cannot be provisioned, in words for the person running the script. */
export function slugProblem(slug: string): string | null {
  if (!SLUG.test(slug)) return "Use 2 to 31 lowercase letters and digits, starting with a letter.";
  if (RESERVED_SLUGS.has(slug)) return `"${slug}" is reserved for the platform.`;
  return null;
}

/**
 * Creates a company end to end (blueprint p13 "Company provisioning", P9):
 * 1. the control rows, in one transaction: tenant (`trial`), organization with the same id, its
 *    products, default branding, and the owner as an unverified user with no password and the
 *    `owner` role key in `member.role` (ADR 0029, part 2);
 * 2. its own database through the DatabaseProvisioner, migrated to the current company schema;
 * 3. its foundation (P10): the products' default roles and the owner's profile with the Owner role.
 *
 * The permission ceiling is every permission of the products' modules, and with no subscription
 * all of the products' modules are on (`enabledModules`), so the owner can work at once. A
 * platform admin narrows both later.
 *
 * A run that stopped after step 1 is finished by running it again with the same slug. A slug that
 * already has a database is refused. The company starts with no subscription; plans and prices are
 * open owner decisions.
 */
export async function provisionTenant(
  control: ControlDb,
  provisioner: DatabaseProvisioner,
  encryptionKey: string,
  provider: string,
  company: NewCompany,
): Promise<ProvisionedTenant> {
  const problem = slugProblem(company.slug);
  if (problem) throw new Error(`Invalid slug: ${problem}`);
  if (company.products.length === 0) throw new Error("Give the company at least one product.");
  const existing = await findUnfinished(control, company);
  const created = existing ?? (await writeControlRows(control, company));
  const url = await provisionCompany(control, provisioner, encryptionKey, {
    tenantId: created.tenantId,
    slug: company.slug,
    provider,
  });
  const companyDb = openCompanyDb(url, { max: 1 });
  try {
    await seedCompanyFoundation(companyDb.db, { products: company.products, ownerUserId: created.ownerUserId });
  } finally {
    await companyDb.close();
  }
  return { ...created, resumed: existing !== null };
}

/**
 * The company with this slug when an earlier run created it but not its database; null when there
 * is no such company. A company that already has a database is an error, never overwritten, and a
 * rerun must name the same owner, so it finishes the same request rather than a different one.
 */
async function findUnfinished(
  control: ControlDb,
  company: NewCompany,
): Promise<Omit<ProvisionedTenant, "resumed"> | null> {
  const slug = company.slug;
  const [tenant] = await control
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.slug, slug), isNull(tenants.deletedAt)));
  if (!tenant) return null;
  const [database] = await control
    .select({ id: tenantDatabases.id })
    .from(tenantDatabases)
    .where(eq(tenantDatabases.tenantId, tenant.id));
  if (database) throw new Error(`A company with the slug "${slug}" already exists.`);
  const [owner] = await control
    .select({ userId: member.userId, email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, tenant.id))
    .limit(1);
  if (!owner) throw new Error(`The company "${slug}" has no owner; fix it by hand before running again.`);
  if (owner.email !== normalisedEmail(company.owner.email)) {
    throw new Error(
      `The unfinished company "${slug}" has a different owner; run again with the original owner's email.`,
    );
  }
  return { tenantId: tenant.id, ownerUserId: owner.userId };
}

async function writeControlRows(control: ControlDb, company: NewCompany): Promise<Omit<ProvisionedTenant, "resumed">> {
  const tenantId = uuidv7();
  const email = normalisedEmail(company.owner.email);
  return control.transaction(async (tx) => {
    await ensureReferenceData(tx);
    await tx.insert(tenants).values({
      id: tenantId,
      slug: company.slug,
      legalName: company.legalName,
      name: company.name,
      city: company.city ?? "",
      state: company.state,
      status: "trial",
      timeZone: company.timeZone,
    });
    await tx
      .insert(organization)
      .values({ id: tenantId, name: company.name, slug: company.slug, createdAt: new Date() });
    const productRows = await tx
      .select({ id: products.id })
      .from(products)
      .where(inArray(products.key, [...company.products]));
    await tx.insert(tenantProducts).values(productRows.map((row) => ({ tenantId, productId: row.id })));
    await tx
      .insert(tenantPermissionCeiling)
      .values(
        productPermissions(company.products).map((permissionKey) => ({ tenantId, permissionKey, allowed: true })),
      );
    const branding = PRODUCT_DEFAULT_BRANDING[company.products[0]];
    await tx.insert(tenantBranding).values({
      tenantId,
      displayName: company.name,
      monogram: monogramOf(company.name),
      brandColor: branding.brandColor,
      pattern: branding.pattern,
    });
    const ownerUserId = await ownerUser(tx, email, company);
    await tx.insert(member).values({
      id: uuidv7(),
      organizationId: tenantId,
      userId: ownerUserId,
      role: encodeMemberRoles(["owner"]),
      createdAt: new Date(),
    });
    return { tenantId, ownerUserId };
  });
}

/**
 * The owner's user id. One person has one user record across companies (blueprint p12), so an
 * existing user with this email can be made owner, but only when the caller says so
 * (`reuseExistingOwner`). Otherwise a new unverified user without a password is made, who signs in
 * once invitation acceptance exists (STATUS).
 */
async function ownerUser(tx: ControlDb, email: string, company: NewCompany): Promise<string> {
  const [found] = await tx.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (found && !company.reuseExistingOwner) {
    throw new Error(`${email} already has an account. To make that person the owner, pass --reuse-owner.`);
  }
  if (found) return found.id;
  const id = uuidv7();
  await tx.insert(user).values({ id, email, name: company.owner.name, emailVerified: false });
  return id;
}

/** An email as stored and compared: trimmed and lowercased. */
function normalisedEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Up to two initials from the company name, for the default logo. */
function monogramOf(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter((word) => /^[A-Za-z]/.test(word))
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
  return initials || "CO";
}
