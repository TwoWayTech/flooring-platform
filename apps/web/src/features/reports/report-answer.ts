import type { ReportKey } from "@workspace/shared";

/** A report's answer kept with the report and the filters it was asked for (ADR 0055 "Also safer"). */
export interface KeyedAnswer<T> {
  reportKey: ReportKey;
  /** The filters the answer was read with, as one comparable string. */
  request: string;
  report: T;
}

/** What a report screen shows: the rows, and whether they belong to filters the person has since changed. */
export interface ShownAnswer<T> {
  report: T | null;
  busy: boolean;
}

/**
 * Which rows a report screen may show, and whether its exports must wait. `useApiQuery` keeps the
 * last answer while the next one loads, so right after a filter changes the answer on hand was
 * asked for other filters: those rows stay, dimmed and `aria-busy`, and the export buttons wait
 * (`busy`), so a CSV or PDF never prints old figures under new filters (ADR 0055 "Also safer",
 * spec Real build). Another report's rows never show; that report gets a skeleton instead.
 */
export function shownAnswer<T>(
  answer: KeyedAnswer<T> | undefined,
  reportKey: ReportKey,
  request: string,
): ShownAnswer<T> {
  if (!answer || answer.reportKey !== reportKey) return { report: null, busy: false };
  return { report: answer.report, busy: answer.request !== request };
}
