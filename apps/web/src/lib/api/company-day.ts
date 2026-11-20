import { dayInZone, isKnownTimeZone } from "@workspace/shared";
import { format } from "date-fns";

/** The browser's own calendar day, "YYYY-MM-DD": the fallback while no company's zone is known. */
export function browserDay(now: Date = new Date()): string {
  return format(now, "yyyy-MM-dd");
}

/**
 * The company's day for the web client in api mode (ADR 0051, "The company's day on the web",
 * 2026-11-20). The API dates and checks every record on the company's day in `tenants.time_zone`
 * (`companyClock`), so a form's default date must be that day too, wherever the browser is: a browser
 * in Tokyo shows Denver's today, never Denver's tomorrow, which the API would refuse as "in the future".
 *
 * The zone is learned from every `GET /company` answer (`company.timeZone`, read only since Settings
 * part 2b) and the day is worked out on every call from the clock, so a tab left open rolls over at
 * the company's midnight. Until a zone is known (the sign-in and platform pages; the shell opens no
 * company screen before `GET /company` answers) it is the browser's day, as before. An answer whose
 * zone Intl doesn't know, and leaving the company for the platform pages, go back to the browser's
 * day rather than keep another company's zone (security review, round 1), so `today()` never throws.
 */
export class CompanyDay {
  private zone: string | null = null;

  /** Keeps the company's zone from a `GET /company` answer; a zone Intl doesn't know means none. */
  learn(zone: string): void {
    this.zone = isKnownTimeZone(zone) ? zone : null;
  }

  /** Drops the zone when no company is open (the platform pages), so the browser's day applies. */
  forget(): void {
    this.zone = null;
  }

  /** Today, "YYYY-MM-DD", in the company's zone once known, else in the browser's. */
  today(now: Date = new Date()): string {
    return this.zone ? dayInZone(now, this.zone) : browserDay(now);
  }
}

const days = new WeakMap<object, CompanyDay>();

/**
 * The one `CompanyDay` of an api-mode client, keyed by the client's demo store: the routes are built
 * per client from the same static API_METHODS, and `today` and the `GET /company` readers must share
 * the zone of their own client only.
 */
export function companyDayOf(client: object): CompanyDay {
  let day = days.get(client);
  if (!day) {
    day = new CompanyDay();
    days.set(client, day);
  }
  return day;
}
