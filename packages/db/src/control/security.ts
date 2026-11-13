import { index, pgTable, text } from "drizzle-orm/pg-core";
import { appendOnly } from "../columns";

/** What an auth attempt row records; see AttemptLog in apps/api for how each kind is counted. */
export type AuthAttemptKind = "password_failed" | "password_ok" | "verification_email";

/**
 * Sign-in failures and sent auth emails, append-only, for the password lockout and the
 * per-address email limit (blueprint p27 "Login"; owner decisions in ADR 0029, part 2). The
 * subject is the email address as typed, trimmed and lowercased, so an address with no account
 * is counted the same way as a real one and the answers reveal nothing.
 */
export const authAttempts = pgTable(
  "auth_attempts",
  {
    ...appendOnly(),
    kind: text().$type<AuthAttemptKind>().notNull(),
    subject: text().notNull(),
    ip: text(),
  },
  (table) => [index("auth_attempts_subject_kind_idx").on(table.subject, table.kind, table.createdAt)],
);
