import type { PlatformAuditResult, PlatformAuditView } from "@workspace/shared";

/**
 * The older pages of the audit log loaded below the newest page. `base` is the newest page's
 * cursor they continue from, `entries` holds them in order and `nextCursor` is where the next
 * older page starts (null once the oldest entry is shown).
 */
export interface OlderAuditPages {
  base: string;
  entries: PlatformAuditView[];
  nextCursor: string | null;
}

/**
 * The older pages that still continue the newest page, or null. When the newest page is read
 * again and now ends at another entry (new entries arrived), pages loaded below the old one would
 * leave a gap, so they are set aside and paging starts again below the newest page.
 */
function continuing(first: PlatformAuditResult, older: OlderAuditPages | null): OlderAuditPages | null {
  return older !== null && older.base === first.nextCursor ? older : null;
}

/** The cursor the next "Load older entries" asks with, or null when the oldest entry is shown. */
export function olderAuditCursor(first: PlatformAuditResult, older: OlderAuditPages | null): string | null {
  const kept = continuing(first, older);
  return kept ? kept.nextCursor : first.nextCursor;
}

/**
 * Every entry to show: the newest page, then the older pages. Paging shows every entry exactly
 * once (docs/specs/platform-admin.md, "GET /platform/audit" and "Screens (part 3)"), so an id
 * already shown is never shown again, and the table never gets two rows with one id.
 */
export function auditRows(first: PlatformAuditResult, older: OlderAuditPages | null): PlatformAuditView[] {
  const kept = continuing(first, older);
  if (!kept) return first.entries;
  const byId = new Map<string, PlatformAuditView>();
  for (const entry of [...first.entries, ...kept.entries]) if (!byId.has(entry.id)) byId.set(entry.id, entry);
  return [...byId.values()];
}

/**
 * Adds the older page that was asked for with `before` below the pages already shown. An answer
 * for a cursor that is no longer the current one is a repeat (a Try again, or a second click, for
 * a page another load already added), so it is dropped and the pages stay as they are.
 */
export function appendOlderAuditPage(
  first: PlatformAuditResult,
  older: OlderAuditPages | null,
  before: string,
  page: PlatformAuditResult,
): OlderAuditPages | null {
  if (before !== olderAuditCursor(first, older)) return older;
  const kept = continuing(first, older);
  return {
    base: kept ? kept.base : before,
    entries: [...(kept?.entries ?? []), ...page.entries],
    nextCursor: page.nextCursor,
  };
}
