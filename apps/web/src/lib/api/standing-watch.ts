import type { ApiClient } from "./contract";
import { HttpApiError } from "./http/transport";

/**
 * The refusal codes that say where the open company stands (docs/specs/platform-admin.md, part 4,
 * "The standing watch"): TenantGuard's maintenance, unavailable and suspended refusals, and the
 * read-only refusal of a write. Any other code, such as `forbidden`, says nothing about standing.
 */
export const STANDING_REFUSAL_CODES: ReadonlySet<string> = new Set([
  "company_maintenance",
  "company_unavailable",
  "company_suspended",
  "company_read_only",
]);

/**
 * ApiClient methods the watch never wraps (ADR 0054). `getCompanyStanding` is what a signal
 * triggers, so watching it could answer a refusal with another read; `getCompanyBilling` is read
 * by the Owner's banner and page, which must never trigger a standing read, so nothing can loop
 * behind the overlay.
 */
const UNWATCHED_METHODS = new Set<PropertyKey>(["getCompanyStanding", "getCompanyBilling"]);

type StandingListener = (code: string) => void;

const listeners = new Set<StandingListener>();

/** Hears every standing refusal an ApiClient call meets; returns the unsubscribe function. */
export function onStandingSignal(listener: StandingListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tells every listener that a call was refused with a standing code. */
export function signalStanding(code: string): void {
  // A copy, so a listener that unsubscribes while it runs changes the next round only.
  [...listeners].forEach((listener) => listener(code));
}

/** Whether a value is a promise or another thenable an async ApiClient method returns. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * Wraps the ApiClient so a refusal with a standing code tells StandingGate to read standing again
 * (spec part 4, "While a page is open"). The same error is rethrown, so the screen handles it as
 * before. Only real API errors (`HttpApiError`) signal; the demo's errors are plain `ApiError`s.
 * Synchronous results, such as `subscribe`'s unsubscribe function, come back untouched.
 */
export function withStandingWatch(client: ApiClient): ApiClient {
  return new Proxy(client, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      if (UNWATCHED_METHODS.has(key)) return value.bind(target);
      return (...args: unknown[]) => {
        const result: unknown = value.apply(target, args);
        if (!isThenable(result)) return result;
        return result.then(undefined, (failure: unknown) => {
          if (failure instanceof HttpApiError && STANDING_REFUSAL_CODES.has(failure.code)) {
            signalStanding(failure.code);
          }
          throw failure;
        });
      };
    },
  });
}
