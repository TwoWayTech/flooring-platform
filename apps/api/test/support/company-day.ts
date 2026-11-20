import { dayInZone } from "@workspace/shared";

/**
 * Today in a time zone (`yyyy-MM-dd`), through the shared `dayInZone` that the API and the web's
 * `today()` both read (ADR 0051, "The company's day on the web"), so the check's days are the
 * product's. Replaces sales-common's `todayIn`, which the today() change folded into it.
 */
export function todayIn(zone: string): string {
  return dayInZone(new Date(), zone);
}
