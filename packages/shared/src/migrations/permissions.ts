import { ALL_PERMISSION_KEYS, permissionDef, RENAMED_PERMISSIONS, type PermissionKey } from "../permissions/catalog";
import type { ModuleKey } from "../products";
import type { Role } from "../types";

/**
 * Permission keys introduced by feature batch 2. Saved ceilings gain them (inside the company's
 * modules) and saved default roles gain the ones their template holds.
 */
export const ADDED_IN_V2: readonly PermissionKey[] = [
  "sales.payment.record",
  "sales.payment.approve",
  "sales.payment.void",
  "sales.payment.refund",
  "sales.payment.write_off",
  "sales.payment.apply_credit",
  "sales.tax.override",
  "sales.waste.view",
  "sales.commission.view",
  "sales.commission.manage",
  "inventory.stock.adjust",
  "inventory.stock.approve",
  "inventory.transfer.view",
  "inventory.transfer.create",
  "inventory.transfer.receive",
  "inventory.reservation.override",
  "purchasing.payment.record",
  "purchasing.payment.approve",
  "purchasing.payment.void",
  "settings.payments.manage",
  "settings.locations.manage",
  "settings.import.manage",
];

const ORDER = new Map(ALL_PERMISSION_KEYS.map((key, index) => [key, index]));

/** Known keys only, once each, in catalog order. */
function tidy(keys: Iterable<string>): PermissionKey[] {
  return [...new Set(keys)]
    .filter((key): key is PermissionKey => permissionDef(key) !== undefined)
    .sort((a, b) => ORDER.get(a)! - ORDER.get(b)!);
}

/** A saved ceiling with retired keys renamed and the new keys of the company's modules added. */
export function upgradeCeiling(ceiling: readonly string[], modules: readonly ModuleKey[]): PermissionKey[] {
  const added = ADDED_IN_V2.filter((key) => modules.includes(permissionDef(key)!.module));
  return tidy([...ceiling.map((key) => RENAMED_PERMISSIONS[key] ?? key), ...added]);
}

/**
 * A saved role on the new keys. The Owner takes the fresh Owner role's permissions. A default
 * role keeps a renamed key only when its new template holds it (Sales no longer records
 * payments by default, spec Appendix A) and gains its template's new keys. A custom role keeps
 * every renamed key and gains nothing.
 */
export function upgradeRole(saved: Role, freshRoles: readonly Role[]): Role {
  const fresh = freshRoles.find((r) => r.id === saved.id);
  if (saved.owner && fresh) return { ...saved, permissions: [...fresh.permissions] };
  const template = saved.system && fresh ? new Set<string>(fresh.permissions) : null;
  const kept = saved.permissions.flatMap((key) => {
    const renamed = RENAMED_PERMISSIONS[key];
    if (!renamed) return [key];
    return !template || template.has(renamed) ? [renamed] : [];
  });
  const added = template ? ADDED_IN_V2.filter((key) => template.has(key)) : [];
  return { ...saved, permissions: tidy([...kept, ...added]) };
}
