import { sql } from "drizzle-orm";
import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { appendOnly, at, business, userRef } from "../columns";
import { tenants } from "./tenants";

/**
 * What an auth attempt row records; see AttemptLog in apps/api for how each kind is counted.
 * `password_attempt` is written before the password is checked and counts as a failure until a
 * later `password_ok` for the same address, so parallel guesses cannot slip past the lockout.
 */
export type AuthAttemptKind =
  | "password_attempt"
  | "password_ok"
  | "verification_email"
  /** A step-up code that passed; the subject is the session id (docs/specs/settings-users-access.md). */
  | "step_up_ok"
  /**
   * A step-up code about to be checked; the subject is the user id. Like `password_attempt`, it is
   * written before the check and counts as a failure until a later `step_up_pass`.
   */
  | "step_up_attempt"
  /** A step-up code that passed, for the lockout; the subject is the user id. */
  | "step_up_pass"
  /** An invitation acceptance or lookup, per IP; the subject is the IP. */
  | "invitation_attempt";

/**
 * Password attempts and sent auth emails, append-only, for the password lockout and the
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

/**
 * An invitation to join a company (docs/specs/settings-users-access.md). Only the SHA-256 of the
 * emailed token is stored, so a copy of this table cannot accept anything. A token is used once
 * and expires after 7 days; inviting the same person again revokes the open one.
 */
export const userInvitations = pgTable(
  "user_invitations",
  {
    ...business(),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    userId: userRef().notNull(),
    tokenHash: text().notNull(),
    expiresAt: at().notNull(),
    acceptedAt: at(),
    revokedAt: at(),
  },
  (table) => [
    uniqueIndex("user_invitations_token_uidx").on(table.tokenHash),
    index("user_invitations_user_idx").on(table.tenantId, table.userId),
    // At most one open invitation per person and company, even when two invites race (PR #11 review).
    uniqueIndex("user_invitations_open_uidx")
      .on(table.tenantId, table.userId)
      .where(sql`accepted_at IS NULL AND revoked_at IS NULL`),
  ],
);
