import {
  enabledModules,
  permissionsForModules,
  resolveAccess,
  roleTemplate,
  type Access,
  type DefaultRoleKey,
  type PermissionKey,
  type ProductKey,
} from "@workspace/shared";
import { readRepoFile, withoutComments } from "./source";

/**
 * The page rules and per-role access the page-gate checks use (whole-product check, PG-1 to PG-4,
 * ADR 0058). pages.ts keeps its view and detail-page rules private, so they are read from its text,
 * exactly as committed; the menus come from the exported product configuration.
 */

/** A view or detail-page rule from pages.ts: a page pattern and the keys that open it. */
export interface SubPageRule {
  pattern: string;
  anyOf: string[];
}

/** The SUB_PAGES rules in apps/web/src/products/pages.ts, in file order. */
export function subPageRules(): SubPageRule[] {
  const code = withoutComments(readRepoFile("apps/web/src/products/pages.ts"));
  const start = code.indexOf("const SUB_PAGES");
  const body = code.slice(start, code.indexOf("];", start));
  return [...body.matchAll(/\{\s*pattern:\s*"([^"]+)",\s*anyOf:\s*\[([^\]]*)\]\s*\}/g)].map((match) => ({
    pattern: match[1] ?? "",
    anyOf: [...(match[2] ?? "").matchAll(/"([^"]+)"/g)].map((key) => key[1] ?? ""),
  }));
}

/**
 * The access one person holding one default role has in a fresh trial of a product, by the shared
 * engine (CLAUDE.md rule 4: role ∩ ceiling ∩ enabled modules), the same company the API's route
 * matrix judges: no plan, so every module of the product; the ceiling every permission of those modules.
 */
export function trialAccess(role: DefaultRoleKey, product: ProductKey): Access {
  const modules = enabledModules([product], null, []);
  const template = roleTemplate(role);
  const ceiling: PermissionKey[] = permissionsForModules(modules);
  return resolveAccess(
    [{ id: role, permissions: template.permissions, dataScope: template.dataScope, owner: template.owner }],
    ceiling,
    modules,
  );
}
