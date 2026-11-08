import { dec } from "./money";

/**
 * How a table column can be filtered (spec A2): text contains, a multi-select of its values
 * (statuses, types), a range for numbers and money, or a range for dates.
 */
export type FilterKind = "text" | "select" | "range" | "date";

/** One column's active filter. Empty bounds are open. */
export type ColumnFilter =
  | { kind: "text"; text: string }
  | { kind: "select"; values: string[] }
  | { kind: "range"; min: string; max: string }
  | { kind: "date"; from: string; to: string };

/** A cell's stored value, as tables sort, search and export it. */
export type CellValue = string | number | null;

/** A table's whole view: search, sort and column filters. It lives in the URL (spec A2). */
export interface TableView {
  search: string;
  sort: { id: string; desc: boolean } | null;
  filters: Record<string, ColumnFilter>;
}

/** Columns with at most this many different values get a multi-select instead of a text box. */
export const SELECT_LIMIT = 15;

/** How an empty cell is named in a multi-select. */
export const BLANK_VALUE = "";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/**
 * The filter a column gets from its values: numbers take a range, ISO dates a date range, few
 * repeating values a multi-select, anything else text contains.
 */
export function inferFilterKind(values: readonly CellValue[], numeric: boolean): FilterKind {
  if (numeric) return "range";
  const present = values.filter((v): v is string | number => v !== null && v !== "");
  if (present.length > 0 && present.every((v) => typeof v === "string" && ISO_DATE.test(v))) return "date";
  const distinct = new Set(present.map(String)).size;
  return distinct > 0 && distinct <= SELECT_LIMIT && distinct < present.length ? "select" : "text";
}

/** Whether a filter narrows anything; an empty one is the same as none. */
export function isActive(filter: ColumnFilter): boolean {
  switch (filter.kind) {
    case "text":
      return filter.text.trim() !== "";
    case "select":
      return filter.values.length > 0;
    case "range":
      return filter.min !== "" || filter.max !== "";
    case "date":
      return filter.from !== "" || filter.to !== "";
  }
}

const isNumber = (text: string) => text.trim() !== "" && Number.isFinite(Number(text));

/** Whether a cell passes a column filter. Ranges are inclusive and compare with decimal math. */
export function matchesFilter(value: CellValue, filter: ColumnFilter): boolean {
  if (!isActive(filter)) return true;
  switch (filter.kind) {
    case "text":
      return String(value ?? "")
        .toLowerCase()
        .includes(filter.text.trim().toLowerCase());
    case "select":
      return filter.values.includes(value === null ? BLANK_VALUE : String(value));
    case "range": {
      if (value === null || value === "" || !isNumber(String(value))) return false;
      const n = dec(value);
      if (isNumber(filter.min) && n.lt(filter.min)) return false;
      return !(isNumber(filter.max) && n.gt(filter.max));
    }
    case "date": {
      if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
      const day = value.slice(0, 10);
      if (filter.from && day < filter.from) return false;
      return !(filter.to && day > filter.to);
    }
  }
}

/** A filter written for the URL: values joined by "|", ranges as "min..max". */
export function encodeFilter(filter: ColumnFilter): string {
  switch (filter.kind) {
    case "text":
      return filter.text;
    case "select":
      return filter.values.join("|");
    case "range":
      return `${filter.min}..${filter.max}`;
    case "date":
      return `${filter.from}..${filter.to}`;
  }
}

/** Reads a filter back from the URL, given the column's kind. */
export function decodeFilter(kind: FilterKind, raw: string): ColumnFilter {
  const [low = "", high = ""] = raw.split("..");
  switch (kind) {
    case "text":
      return { kind, text: raw };
    case "select":
      return { kind, values: raw.split("|") };
    case "range":
      return { kind, min: low, max: high };
    case "date":
      return { kind, from: low, to: high };
  }
}

const key = (tableId: string, part: string) => `${tableId}.${part}`;

/** URL query entries of a view, under the table's own prefix so several tables can share a page. */
export function viewToParams(tableId: string, view: TableView): [string, string][] {
  const entries: [string, string][] = [];
  if (view.search.trim()) entries.push([key(tableId, "q"), view.search.trim()]);
  if (view.sort) entries.push([key(tableId, "sort"), `${view.sort.desc ? "-" : ""}${view.sort.id}`]);
  for (const [column, filter] of Object.entries(view.filters)) {
    if (isActive(filter)) entries.push([key(tableId, `f.${column}`), encodeFilter(filter)]);
  }
  return entries;
}

/**
 * The view a URL holds for one table, or null when the URL says nothing about it. Filters on
 * columns the table does not have are dropped.
 */
export function viewFromParams(
  tableId: string,
  params: Iterable<[string, string]>,
  kinds: Readonly<Record<string, FilterKind>>,
): TableView | null {
  const prefix = `${tableId}.`;
  const view: TableView = { search: "", sort: null, filters: {} };
  let found = false;
  for (const [name, value] of params) {
    if (!name.startsWith(prefix)) continue;
    found = true;
    const part = name.slice(prefix.length);
    if (part === "q") view.search = value;
    else if (part === "sort") view.sort = { id: value.replace(/^-/, ""), desc: value.startsWith("-") };
    else if (part.startsWith("f.")) {
      const column = part.slice(2);
      const kind = kinds[column];
      if (kind) view.filters[column] = decodeFilter(kind, value);
    }
  }
  return found ? view : null;
}

/** A link to a page with one table filtered to some values, e.g. overdue invoices from "Needs attention". */
export function filteredHref(path: string, tableId: string, column: string, values: readonly string[]): string {
  const [base, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.set(key(tableId, `f.${column}`), values.join("|"));
  return `${base}?${params.toString()}`;
}
