import { openControlDb, type ControlDb } from "@workspace/db";
import { platformAdmins } from "@workspace/db/control";
import { eq, sql } from "drizzle-orm";
import type { AuthHarness } from "../auth-harness";

/**
 * Helpers for the lock on a platform admin's own `platform_admins` row (`lockActingAdmin`;
 * docs/specs/platform-admin.md, part 3 "Why a row lock" and part 2 "Who may call what (part 2)"),
 * bound to one harness: how many connections wait for a lock, a wait until enough do, and a lock
 * held from a connection of its own, as a parallel write would hold it. Moved unchanged from
 * platform-support.int.test.ts so the part 2 tests use the same ones.
 */
export function adminLocks(harness: AuthHarness) {
  /** How many connections of the scratch control database are waiting for a lock. */
  async function lockWaiters(): Promise<number> {
    const rows = await harness.control.db.execute<{ n: number }>(
      sql`select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()`,
    );
    return rows[0]?.n ?? 0;
  }

  /** Waits until at least `n` connections wait for a lock, polling every 50 ms, for at most 10 s. */
  async function waitForLockWaiters(n: number): Promise<void> {
    const deadline = Date.now() + 10_000;
    while ((await lockWaiters()) < n) {
      if (Date.now() > deadline) throw new Error(`Fewer than ${n} requests ever waited for the lock.`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /**
   * Holds a lock on an admin's `platform_admins` row from a connection of its own, as a parallel
   * request would, until `release()`; `whileHeld` runs in the same transaction just before it commits.
   */
  async function holdAdminRow(userId: string, whileHeld?: (tx: ControlDb) => Promise<void>) {
    const lock = openControlDb(harness.controlUrl, { max: 1 });
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked = () => {};
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const done = lock.db.transaction(async (tx) => {
      await tx.select().from(platformAdmins).where(eq(platformAdmins.userId, userId)).for("update");
      locked();
      await released;
      await whileHeld?.(tx);
    });
    // A transaction that fails before it locks rejects here instead of hanging the test.
    await Promise.race([isLocked, done]);
    return {
      release,
      finish: async () => {
        release();
        try {
          await done;
        } finally {
          await lock.close();
        }
      },
    };
  }

  return { lockWaiters, waitForLockWaiters, holdAdminRow };
}
