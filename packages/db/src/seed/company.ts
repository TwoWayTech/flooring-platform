import type { CompanySettings } from "@workspace/shared";
import type { CompanyDb } from "../client";
import {
  branches,
  documentSequences,
  locations,
  rolePermissions,
  roles,
  settings,
  taxJurisdictions,
  taxRules,
  userProfiles,
  userRoles,
  type SettingsGroup,
} from "../company";
import { seededUserId } from "./control";
import { seedId, type DemoCompany } from "./fixtures";

/** Settings groups as stored: branding lives in the control database, tax rules and county rates in their own tables. */
function settingsRows(companyId: string, value: CompanySettings) {
  const { branding, localization, ...rest } = value;
  const { rules, jurisdictions, ...tax } = localization.tax;
  const groups: Record<SettingsGroup, unknown> = { ...rest, localization: { ...localization, tax } };
  return Object.entries(groups).map(([group, groupValue]) => ({
    id: seedId(`${companyId}:settings:${group}`),
    group: group as SettingsGroup,
    value: groupValue,
  }));
}

/** The numbering each document kind starts from, with the company's prefixes. */
function sequenceRows(companyId: string, value: CompanySettings) {
  const documents = value.localization.documents;
  const prefixes = {
    quote: documents.quotePrefix,
    invoice: documents.invoicePrefix,
    purchase_order: documents.poPrefix,
    payment: value.payments.paymentPrefix,
    refund: value.payments.refundPrefix,
  };
  return Object.entries(prefixes).map(([kind, prefix]) => ({
    id: seedId(`${companyId}:sequence:${kind}`),
    kind,
    prefix,
  }));
}

async function seedOrganization(tx: CompanyDb, { company, fixtures }: DemoCompany): Promise<void> {
  await tx
    .insert(branches)
    .values(company.branches.map((branch) => ({ ...branch, id: seedId(branch.id) })))
    .onConflictDoNothing();
  await tx
    .insert(locations)
    .values(
      fixtures.locations.map((location) => ({
        ...location,
        id: seedId(location.id),
        branchId: seedId(location.branchId),
        floorAreaSqFt: location.floorAreaSqFt ?? null,
      })),
    )
    .onConflictDoNothing();
  await tx.insert(settings).values(settingsRows(company.id, fixtures.settings)).onConflictDoNothing();
  await tx.insert(documentSequences).values(sequenceRows(company.id, fixtures.settings)).onConflictDoNothing();
  const tax = fixtures.settings.localization.tax;
  if (tax.rules.length > 0) {
    await tx
      .insert(taxRules)
      .values(
        tax.rules.map((rule) => ({
          ...rule,
          id: seedId(`${company.id}:tax:${rule.state}:${rule.version}`),
          validTo: rule.validTo ?? null,
        })),
      )
      .onConflictDoNothing();
  }
  if (tax.jurisdictions.length > 0) {
    await tx
      .insert(taxJurisdictions)
      .values(tax.jurisdictions.map((rate) => ({ ...rate, id: seedId(`${company.id}:${rate.id}`) })))
      .onConflictDoNothing();
  }
}

async function seedAccess(tx: CompanyDb, { fixtures }: DemoCompany): Promise<void> {
  for (const role of fixtures.roles) {
    const roleId = seedId(role.id);
    await tx
      .insert(roles)
      .values({
        id: roleId,
        key: role.key,
        name: role.name,
        description: role.description,
        dataScope: role.dataScope,
        system: role.system,
        owner: role.owner,
      })
      .onConflictDoNothing();
    await tx
      .insert(rolePermissions)
      .values(role.permissions.map((key) => ({ id: seedId(`${role.id}:${key}`), roleId, permissionKey: key })))
      .onConflictDoNothing();
  }
  for (const person of fixtures.users) {
    const userId = seededUserId(person.id);
    // Employees arrive with the HR module, so the employee link stays empty for now.
    await tx
      .insert(userProfiles)
      .values({
        id: seedId(`profile:${person.id}`),
        userId,
        title: person.title,
        branchId: seedId(person.branchId),
        status: person.status,
        defaultLocationId: person.defaultLocationId ? seedId(person.defaultLocationId) : null,
      })
      .onConflictDoNothing();
    await tx
      .insert(userRoles)
      .values(
        person.roleIds.map((roleId) => ({ id: seedId(`${person.id}:${roleId}`), userId, roleId: seedId(roleId) })),
      )
      .onConflictDoNothing();
  }
}

/**
 * Seeds the foundation of one company database: branches, locations, settings, tax rules,
 * numbering, roles and user profiles. Business records arrive module by module
 * (docs/real-build-plan.md), each with its own seed.
 */
export async function seedCompany(company: CompanyDb, demo: DemoCompany): Promise<void> {
  await company.transaction(async (tx) => {
    await seedOrganization(tx, demo);
    await seedAccess(tx, demo);
  });
}
