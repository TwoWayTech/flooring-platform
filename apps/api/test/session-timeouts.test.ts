import { describe, expect, it } from "vitest";
import { DEFAULT_TIMEOUTS, sessionExpiry, shouldRecordActivity } from "../src/core/auth/session-timeouts";

const now = new Date("2026-11-12T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

describe("session timeouts (blueprint p28)", () => {
  it("defaults to 30 minutes idle and 12 hours absolute", () => {
    expect(DEFAULT_TIMEOUTS).toEqual({ idleMin: 30, absoluteMin: 720 });
  });

  it("keeps a session that is within both limits", () => {
    expect(sessionExpiry({ createdAt: minutesAgo(700), updatedAt: minutesAgo(30) }, DEFAULT_TIMEOUTS, now)).toBeNull();
  });

  it("ends a session idle for longer than the idle timeout", () => {
    expect(sessionExpiry({ createdAt: minutesAgo(40), updatedAt: minutesAgo(31) }, DEFAULT_TIMEOUTS, now)).toBe("idle");
  });

  it("ends a session past the absolute timeout even when it is active", () => {
    expect(sessionExpiry({ createdAt: minutesAgo(721), updatedAt: now }, DEFAULT_TIMEOUTS, now)).toBe("absolute");
  });

  it("records activity at most once a minute", () => {
    expect(shouldRecordActivity({ createdAt: minutesAgo(5), updatedAt: minutesAgo(0.5) }, now)).toBe(false);
    expect(shouldRecordActivity({ createdAt: minutesAgo(5), updatedAt: minutesAgo(1) }, now)).toBe(true);
  });
});
