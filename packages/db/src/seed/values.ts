import { seededUserId } from "./control";

/**
 * A fixture timestamp as an instant. Fixture times such as `2026-04-16T14:15` carry no zone, which
 * JavaScript would read as the machine's local time; they are UTC, so every machine seeds the same.
 */
export function utc(value: string): Date {
  return new Date(/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value) ? `${value}Z` : value);
}

/** A fixture user id as the control database's user id, or null when there is none. */
export function userOf(id: string | null | undefined): string | null {
  return id ? seededUserId(id) : null;
}
