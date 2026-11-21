import { describe, expect, it } from "vitest";
import {
  calendarDateText,
  clockText,
  isMarkedMoment,
  isMoment,
  momentInZone,
  momentIso,
  momentText,
  utcMinuteAsInstant,
} from "../src";

const DENVER = "America/Denver";

describe("moments in the company's zone (ADR 0064)", () => {
  it("reads an instant with its mark on the company's clock and names the zone", () => {
    // Click-through #57: 14:56 UTC is 7:56 AM in Denver, not 2:56 PM.
    expect(momentText("2026-11-21T14:56:00.000Z", DENVER)).toBe("Nov 21, 2026, 7:56 AM MST");
    expect(momentInZone("2026-11-21T14:56:00.000Z", DENVER)).toMatchObject({
      wall: "2026-11-21T07:56",
      abbreviation: "MST",
      offset: "-07:00",
    });
  });

  it("reads an offset other than Z as the same instant", () => {
    expect(momentText("2026-11-21T09:56:00-05:00", DENVER)).toBe("Nov 21, 2026, 7:56 AM MST");
  });

  it("reads a wall time with no mark as the zone's own clock", () => {
    expect(momentText("2026-11-21T07:56", DENVER)).toBe("Nov 21, 2026, 7:56 AM MST");
    expect(momentInZone("2026-11-21T07:56", DENVER)?.instant.toISOString()).toBe("2026-11-21T14:56:00.000Z");
  });

  it("follows Denver's daylight saving time across both changes", () => {
    // 2026-03-08 02:00 MST the clocks go to 03:00 MDT; 2026-11-01 02:00 MDT they go back to 01:00 MST.
    expect(momentText("2026-03-08T08:59:00Z", DENVER)).toBe("Mar 8, 2026, 1:59 AM MST");
    expect(momentText("2026-03-08T09:00:00Z", DENVER)).toBe("Mar 8, 2026, 3:00 AM MDT");
    expect(momentText("2026-11-01T07:59:00Z", DENVER)).toBe("Nov 1, 2026, 1:59 AM MDT");
    expect(momentText("2026-11-01T08:00:00Z", DENVER)).toBe("Nov 1, 2026, 1:00 AM MST");
    expect(momentIso("2026-07-04T18:30:15.000Z", DENVER)).toBe("2026-07-04T12:30:15-06:00");
    expect(momentIso("2026-12-04T18:30:00.000Z", DENVER)).toBe("2026-12-04T11:30:00-07:00");
  });

  it("reads a wall time in the autumn overlap as the earlier instant, and one in the spring gap as daylight time", () => {
    expect(momentIso("2026-11-01T01:30", DENVER)).toBe("2026-11-01T01:30:00-06:00");
    expect(momentText("2026-03-08T02:30", DENVER)).toBe("Mar 8, 2026, 2:30 AM MDT");
  });

  it("works in a zone that is neither the browser's nor American", () => {
    expect(momentText("2026-11-21T14:56:00Z", "Asia/Kolkata")).toBe("Nov 21, 2026, 8:26 PM GMT+5:30");
    expect(momentIso("2026-11-21T14:56:00Z", "Asia/Kolkata")).toBe("2026-11-21T20:26:00+05:30");
    expect(momentText("2026-11-21T14:56:00Z", "Pacific/Honolulu")).toBe("Nov 21, 2026, 4:56 AM HST");
  });

  it("writes 12-hour times", () => {
    expect(clockText("2026-11-21T00:05")).toBe("12:05 AM");
    expect(clockText("2026-11-21T12:00")).toBe("12:00 PM");
    expect(clockText("2026-11-21T15:04")).toBe("3:04 PM");
    expect(clockText("2026-11-21T09:30")).toBe("9:30 AM");
  });

  it("leaves calendar dates and other text alone", () => {
    expect(isMoment("2026-11-21")).toBe(false);
    expect(momentInZone("2026-11-21", DENVER)).toBeNull();
    expect(momentText("2026-11-21", DENVER)).toBe("2026-11-21");
    expect(momentIso("Pending", DENVER)).toBe("Pending");
    expect(momentInZone("2026-11-21T14:56:00Z", "Mars/Olympus")).toBeNull();
    expect(calendarDateText("2026-01-05")).toBe("Jan 5, 2026");
  });

  it("tells marked instants from wall times, and reads a legacy API minute as UTC", () => {
    expect(isMarkedMoment("2026-11-21T14:56:00.000Z")).toBe(true);
    expect(isMarkedMoment("2026-11-21T14:56")).toBe(false);
    expect(utcMinuteAsInstant("2026-11-21T14:56")).toBe("2026-11-21T14:56:00.000Z");
    expect(utcMinuteAsInstant("2026-11-21T14:56:00.000Z")).toBe("2026-11-21T14:56:00.000Z");
    expect(utcMinuteAsInstant("2026-11-21")).toBe("2026-11-21");
  });
});
