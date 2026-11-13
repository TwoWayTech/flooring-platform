import { describe, expect, it } from "vitest";
import { attemptSubject, lockEnd, type PasswordAttempt } from "../src/core/auth/attempts";
import { mfaState } from "../src/core/auth/mfa-policy";

const now = new Date("2026-11-13T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const failed = (minutes: number): PasswordAttempt => ({ kind: "password_attempt", at: minutesAgo(minutes) });
const ok = (minutes: number): PasswordAttempt => ({ kind: "password_ok", at: minutesAgo(minutes) });

describe("lockEnd (owner decision 2026-11-13: 5 failures in 15 minutes lock for 15 minutes)", () => {
  it("locks for 15 minutes from the fifth failure", () => {
    expect(lockEnd([failed(1), failed(2), failed(3), failed(4), failed(5)], now)).toEqual(
      new Date(minutesAgo(1).getTime() + 15 * 60_000),
    );
  });

  it("does not lock on 4 failures", () => {
    expect(lockEnd([failed(1), failed(2), failed(3), failed(4)], now)).toBeNull();
  });

  it("does not lock when a success is among the last 5", () => {
    expect(lockEnd([failed(1), failed(2), ok(3), failed(4), failed(5)], now)).toBeNull();
  });

  it("does not lock when the 5 failures span more than 15 minutes", () => {
    expect(lockEnd([failed(1), failed(2), failed(3), failed(4), failed(17)], now)).toBeNull();
  });

  it("ends the lock 15 minutes after the newest failure", () => {
    expect(lockEnd([failed(16), failed(17), failed(18), failed(19), failed(20)], now)).toBeNull();
  });
});

describe("attemptSubject", () => {
  it("trims and lowercases the address", () => {
    expect(attemptSubject("  Dana@Example.TEST ")).toBe("dana@example.test");
  });
});

describe("mfaState (blueprint p27)", () => {
  it("asks a required user with no factor to enrol", () => {
    expect(mfaState(true, false, 0)).toBe("enrolment_required");
  });

  it("is satisfied by an authenticator app or a passkey", () => {
    expect(mfaState(true, true, 0)).toBe("ok");
    expect(mfaState(true, false, 1)).toBe("ok");
  });

  it("never asks a user who need not use MFA", () => {
    expect(mfaState(false, false, 0)).toBe("ok");
  });
});
