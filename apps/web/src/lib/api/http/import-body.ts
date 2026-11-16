import {
  IMPORT_LIMITS,
  IMPORT_TOO_LARGE,
  importKind,
  mappedTable,
  type ColumnMapping,
  type ImportRequest,
} from "@workspace/shared";
import { ApiError } from "../errors";

/**
 * An import request as the API takes it (ADR 0057; docs/api-contract.md "Data import, part 1"):
 * the kind, the file name, only the chosen columns of the file in field order with every row (so
 * row numbers stay; S-15), the column choice of each of the kind's fields, and on a commit the dry
 * run's action per row (S-10). Rebuilt, so nothing else on the request travels: the API's schema
 * is strict, and the company is the session's, never the body's (CLAUDE.md rule 2).
 *
 * Refused here, before anything is sent, when the body is over the API's JSON limit, counted in
 * UTF-8 bytes as the body parser counts them (S-12), so the person gets words, not a bare 413.
 */
export function importBody(request: ImportRequest, expected?: string): ImportRequest {
  const def = importKind(request.kind);
  const mapping: ColumnMapping = Object.fromEntries(
    def.fields.map((field) => [
      field.key,
      (Object.hasOwn(request.mapping, field.key) && request.mapping[field.key]) || null,
    ]),
  );
  const body: ImportRequest = {
    kind: request.kind,
    fileName: request.fileName,
    table: mappedTable(def, request),
    mapping,
    ...(expected ? { expected } : {}),
  };
  if (new TextEncoder().encode(JSON.stringify(body)).length > IMPORT_LIMITS.requestBytes) {
    throw new ApiError(IMPORT_TOO_LARGE);
  }
  return body;
}
