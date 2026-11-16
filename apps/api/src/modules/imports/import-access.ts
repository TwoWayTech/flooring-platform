import { ForbiddenException, NotFoundException, type HttpException } from "@nestjs/common";
import {
  importKindRefusal,
  importKindsOpen,
  sensitiveColumnRefusal,
  type ColumnMapping,
  type ImportHolder,
  type ImportKind,
  type ImportRefusal,
  type ModuleKey,
} from "@workspace/shared";
import type { KindStore } from "./kind-store";
import { KIND_STORES } from "./kind-stores";

/** Who imports, as the import rules read them: effective keys, data scope and the company's modules. */
export type ImportAccess = ImportHolder & { modules: readonly ModuleKey[] };

/** The kinds part 1 runs on the API (ADR 0057 S-1); every other kind answers 404. */
export const SERVER_IMPORT_KINDS: readonly ImportKind[] = Object.keys(KIND_STORES) as ImportKind[];

const NOT_AVAILABLE = "This kind of import is not available.";

/** A shared refusal as the HTTP error it is answered with (403 or 404, with its code and words). */
function asHttp(refusal: ImportRefusal): HttpException {
  const body = { code: refusal.code, message: refusal.message };
  return refusal.status === 404 ? new NotFoundException(body) : new ForbiddenException(body);
}

/**
 * The store of a kind the person may import, or the refusal (ADR 0057 S-1 to S-3): 404 for a kind
 * part 1 doesn't run or whose switch is off, 403 for a company without the module, a data scope
 * narrower than the company, or a missing key of the kind's own. Deny by default.
 */
export function openKind(access: ImportAccess, kind: ImportKind): KindStore {
  const store = KIND_STORES[kind];
  if (!store) throw new NotFoundException({ code: "not_found", message: NOT_AVAILABLE });
  const refusal = importKindRefusal(kind, access.modules, access);
  if (refusal) throw asHttp(refusal);
  return store;
}

/**
 * Refuses a mapping that chooses a sensitive column the person may not see (CLAUDE.md rule 5;
 * ADR 0057 S-4): a credit limit or a cost. Undo checks the batch's own mapping, since it puts
 * those values back.
 */
export function openColumns(access: ImportAccess, kind: ImportKind, mapping: ColumnMapping): void {
  const refusal = sensitiveColumnRefusal(kind, mapping, access);
  if (refusal) throw asHttp(refusal);
}

/** The kinds the person may import on the API, in wizard order (ADR 0057 S-1 to S-3). */
export function openKinds(access: ImportAccess): ImportKind[] {
  return importKindsOpen(access.modules, access).filter((kind) => SERVER_IMPORT_KINDS.includes(kind));
}
