import { BadRequestException } from "@nestjs/common";
import { IMPORT_KIND_LIST, IMPORT_LIMITS, type ImportKind } from "@workspace/shared";
import { z } from "zod";

/** Any C0 control character or DEL: never in a header, file name or column choice (ADR 0057 S-17). */
const CONTROL = /[\u0000-\u001f\u007f]/;

/** What a header, file name or column choice with a control character is told (ADR 0057 S-17). */
const CONTROL_WORDS = "A column name or file name holds a hidden control character.";

/** What an unknown kind is told, in the body and in the mapping route's path. */
const CHOOSE_KIND = "Choose what to import.";

/** What an import without the dry run's actions is told (ADR 0057 S-10). */
const CHECK_AGAIN = "Check the file again before importing.";

/** What a body naming a field the import doesn't take is told: a `companyId` above all (CLAUDE.md rule 2). */
const UNKNOWN_FIELD = "The request has a field this import doesn't take.";

/** A strict object whose extra fields are refused with the import's own words. */
const strict = <T extends z.ZodRawShape>(shape: T) =>
  z.strictObject(shape, { error: (issue) => (issue.code === "unrecognized_keys" ? UNKNOWN_FIELD : undefined) });

/**
 * A cell as the browser parsed it (ADR 0057 S-12, S-17). Its other control characters are refused
 * by the field rules (`readCell`) only where the column is chosen; NUL never travels.
 */
const CELL = z
  .string()
  .max(IMPORT_LIMITS.cellChars, "A cell is longer than 1,000 characters. Shorten it or leave that column out.")
  .refine((cell) => !cell.includes("\u0000"), "A cell holds a NUL character. Remove it and try again.");

/** A header, file name or column choice: a length cap and no control character (ADR 0057 S-17). */
const label = (max: number, words: string) =>
  z
    .string()
    .max(max, words)
    .refine((text) => !CONTROL.test(text), CONTROL_WORDS);

const HEADER = label(IMPORT_LIMITS.headerChars, "A column header is longer than 200 characters.");

/**
 * The chosen columns of the file (ADR 0057 S-12, S-15): at most 60 headers, each once, and at most
 * 2,000 rows of at most 60 cells.
 */
const TABLE = strict({
  headers: z
    .array(HEADER)
    .min(1, "The file has no header row.")
    .max(IMPORT_LIMITS.columns, "A file can have at most 60 columns."),
  rows: z
    .array(z.array(CELL).max(IMPORT_LIMITS.columns, "A row has more than 60 cells."))
    .min(1, "The file has no rows under the header row.")
    .max(IMPORT_LIMITS.rows, "Import at most 2,000 rows at a time; split the file."),
}).refine(
  (table) => new Set(table.headers).size === table.headers.length,
  "Two columns have the same header. Rename one and try again.",
);

/** What a column choice naming no field of the kind is told, `__proto__` included. */
const UNKNOWN_CHOICE = "The column choices name a field this import doesn't have.";

/**
 * The column choices, field key to header (ADR 0057 S-17). A `__proto__` key is refused on the
 * raw body, before a record is built, so it can never reach an object's prototype; a key with a
 * control character or too long for any field is refused here, and any other unknown field by
 * `mappingFor`.
 */
const MAPPING = z
  .unknown()
  .refine((raw) => !(typeof raw === "object" && raw !== null && Object.hasOwn(raw, "__proto__")), UNKNOWN_CHOICE)
  .pipe(
    z
      .record(z.string(), HEADER.nullable())
      .refine((mapping) => Object.keys(mapping).length <= IMPORT_LIMITS.columns, "Choose at most 60 columns.")
      .refine((mapping) => Object.keys(mapping).every((key) => !CONTROL.test(key)), CONTROL_WORDS)
      .refine((mapping) => Object.keys(mapping).every((key) => key.length <= 60), UNKNOWN_CHOICE),
  );

const REQUEST_SHAPE = {
  kind: z.enum(IMPORT_KIND_LIST, { error: CHOOSE_KIND }),
  fileName: label(IMPORT_LIMITS.fileNameChars, "A file name is at most 200 characters.")
    .transform((name) => name.trim())
    .pipe(z.string().min(1, "Name the file.")),
  table: TABLE,
  mapping: MAPPING,
};

/** The body of a dry run (`POST /imports/check`): only the chosen columns, and never a company (ADR 0057). */
export const IMPORT_REQUEST = strict(REQUEST_SHAPE);

/**
 * The body of an import (`POST /imports`): the dry run's body plus its action per row (ADR 0057
 * S-10), which the import must reproduce.
 */
export const IMPORT_COMMIT = strict({
  ...REQUEST_SHAPE,
  expected: z.string({ error: CHECK_AGAIN }).regex(/^[cuse]{1,2000}$/, CHECK_AGAIN),
});

/** The body of `PUT /imports/mappings/:kind`: the column choices to keep for the next file. */
export const MAPPING_SAVE = strict({ columns: MAPPING });

/** A dry run's body as the service takes it. */
export type ImportInput = z.infer<typeof IMPORT_REQUEST>;

/** An import's body as the service takes it. */
export type ImportCommitInput = z.infer<typeof IMPORT_COMMIT>;

/** The kind in the mapping route's path, one of the import kinds; anything else is a 400. */
export function parseKind(param: string): ImportKind {
  const kind = IMPORT_KIND_LIST.find((candidate) => candidate === param);
  if (!kind) throw new BadRequestException({ code: "invalid_request", message: CHOOSE_KIND });
  return kind;
}
