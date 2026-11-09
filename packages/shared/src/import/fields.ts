import { dec, moneyString } from "../money";
import type { ImportField } from "./types";

/** A cell read by its field type: text, a yes or no, or the list of chosen values. */
export type ImportCellValue = string | boolean | string[];

/** A cell's value, or the reason it cannot be read. */
export type ImportCellResult = { value: ImportCellValue | null } | { error: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DECIMAL = /^\d+(\.\d+)?$/;
const YES = new Set(["yes", "y", "true", "1", "x"]);
const NO = new Set(["no", "n", "false", "0"]);
const UNIT_SPELLINGS: Record<NonNullable<ImportField["unit"]>, readonly string[]> = {
  ft: ["ft", "feet", "foot", "'"],
  "sq ft": ["sq ft", "sqft", "sf", "ft2", "ft²"],
};

/** Lower case with spaces, dashes and underscores folded, so "Job site", "job_site" and "JOB-SITE" match. */
export const fold = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");

/**
 * Money (spec G1 "money and unit formats"): an optional $ and thousands commas, at most two
 * decimals, never negative. "$1,250.5" reads as 1250.50.
 */
function readMoney(raw: string): ImportCellResult {
  const plain = raw.replace(/[$,\s]/g, "");
  if (!DECIMAL.test(plain)) return { error: `“${raw}” is not an amount. Write it like 1250.00.` };
  if ((plain.split(".")[1] ?? "").length > 2) return { error: `“${raw}” has more than two decimals.` };
  return { value: moneyString(plain) };
}

/** A number, optionally followed by the field's unit ("12 ft", "12'"); another unit is an error. */
function readNumber(raw: string, field: ImportField, whole: boolean): ImportCellResult {
  const match = /^([\d.,]+)\s*(.*)$/.exec(raw);
  const digits = match?.[1]?.replace(/,/g, "") ?? "";
  const suffix = fold(match?.[2] ?? "");
  if (!DECIMAL.test(digits)) return { error: `“${raw}” is not a number.` };
  if (suffix && !(field.unit && UNIT_SPELLINGS[field.unit].includes(suffix))) {
    return {
      error: field.unit ? `Write “${raw}” in ${field.unit}, like 12 ${field.unit}.` : `“${raw}” is not a number.`,
    };
  }
  if (whole && !Number.isInteger(Number(digits))) return { error: `“${raw}” is not a whole number.` };
  return { value: dec(digits).toString() };
}

/** A real calendar date written 2026-03-15, 3/15/2026 or 3/15/26, as YYYY-MM-DD. */
function readDate(raw: string): ImportCellResult {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(raw);
  const parts = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : us
      ? [Number(us[3]!.length === 2 ? `20${us[3]}` : us[3]), Number(us[1]), Number(us[2])]
      : null;
  if (parts) {
    const [y, m, d] = parts as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d) {
      return { value: date.toISOString().slice(0, 10) };
    }
  }
  return { error: `“${raw}” is not a date. Write it like 2026-03-15 or 3/15/2026.` };
}

/** One value of a choice field, typed as its label or its stored value. */
function readChoice(raw: string, field: ImportField): ImportCellResult {
  const choices = field.choices ?? {};
  const wanted = fold(raw);
  const found = Object.entries(choices).find(([value, label]) => fold(value) === wanted || fold(label) === wanted);
  if (found) return { value: found[0] };
  const labels = Object.values(choices);
  const hint = labels.length > 12 ? `a value like ${field.examples[0]}` : `one of: ${labels.join(", ")}`;
  return { error: `Unknown ${field.label.toLowerCase()} “${raw}”. Use ${hint}.` };
}

/** Several choices separated by semicolons or vertical bars. */
function readList(raw: string, field: ImportField): ImportCellResult {
  const values: string[] = [];
  for (const part of raw
    .split(/[;|]/)
    .map((p) => p.trim())
    .filter(Boolean)) {
    const one = readChoice(part, field);
    if ("error" in one) return one;
    values.push(one.value as string);
  }
  return { value: [...new Set(values)] };
}

/**
 * Reads one cell by its field's type (spec G1 "Validate: types, required fields, money and unit
 * formats"). An empty cell is null, or an error when the field is required.
 */
export function readCell(field: ImportField, text: string): ImportCellResult {
  const raw = text.trim();
  if (!raw) return field.required ? { error: `${field.label} is required.` } : { value: null };
  switch (field.type) {
    case "email":
      return EMAIL.test(raw) ? { value: raw.toLowerCase() } : { error: `“${raw}” is not an email address.` };
    case "money":
      return readMoney(raw);
    case "number":
      return readNumber(raw, field, false);
    case "integer":
      return readNumber(raw, field, true);
    case "date":
      return readDate(raw);
    case "bool":
      if (YES.has(fold(raw))) return { value: true };
      if (NO.has(fold(raw))) return { value: false };
      return { error: `Write yes or no, not “${raw}”.` };
    case "choice":
      return readChoice(raw, field);
    case "list":
      return readList(raw, field);
    case "text":
      return { value: raw };
  }
}
