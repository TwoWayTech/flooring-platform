import { ALL_PERMISSION_KEYS, permissionDef, RENAMED_PERMISSIONS, type PermissionKey } from "../permissions/catalog";
import type { ModuleKey } from "../products";

const ADDED_SINCE_FIRST_DEMO =
  /^(sales\.(payment|tax|waste|commission)\.|inventory\.(stock|transfer|reservation)\.|purchasing\.payment\.|finance\.|contracts\.|hr\.commission\.|hr\.payroll\.(view|approve)$|settings\.(payments|locations|import|expenses|notifications|outbox|hr|meetings)\.)/;

/**
 * Permission keys added since the first demo. A company ceiling saved by the super-admin in an
 * older demo gains the ones its modules allow.
 */
export const ADDED_PERMISSIONS: readonly PermissionKey[] = ALL_PERMISSION_KEYS.filter((key) =>
  ADDED_SINCE_FIRST_DEMO.test(key),
);

const ORDER = new Map(ALL_PERMISSION_KEYS.map((key, index) => [key, index]));

/** Known keys only, once each, in catalog order. */
function tidy(keys: Iterable<string>): PermissionKey[] {
  return [...new Set(keys)]
    .filter((key): key is PermissionKey => permissionDef(key) !== undefined)
    .sort((a, b) => ORDER.get(a)! - ORDER.get(b)!);
}

/** A saved ceiling with retired keys renamed and the new keys of the company's modules added. */
export function upgradeCeiling(ceiling: readonly string[], modules: readonly ModuleKey[]): PermissionKey[] {
  const added = ADDED_PERMISSIONS.filter((key) => modules.includes(permissionDef(key)!.module));
  return tidy([...ceiling.map((key) => RENAMED_PERMISSIONS[key] ?? key), ...added]);
}
