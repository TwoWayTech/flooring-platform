/** The longest address a meeting accepts (RFC 5321 section 4.5.3.1.3 caps a path at 256 with brackets). */
export const GUEST_EMAIL_MAX = 254;

/** Characters an invite address may not hold: controls, spaces and the separators of a header or a calendar line. */
const UNSAFE_IN_EMAIL = /[\u0000-\u0020\u007f-\u009f\u2028\u2029"(),:;<>[\\\]]/;

/**
 * Whether an address is good enough to invite and to write into a calendar file (meetings.md rule
 * 12, made stricter in ADR 0051 "Input limits"): the spec's `x@y.z` shape, at most 254 characters,
 * and none of the characters that could end a calendar line or a mail header or need quoting. An
 * unusual but valid quoted address is refused rather than risk a broken invite.
 */
export function validGuestEmail(email: string): boolean {
  return email.length <= GUEST_EMAIL_MAX && !UNSAFE_IN_EMAIL.test(email) && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

/** An address as guests are compared: trimmed and lower case, so one person is invited once (ADR 0051). */
export function normalizeGuestEmail(email: string): string {
  return email.trim().toLowerCase();
}
