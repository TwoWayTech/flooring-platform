import { formatClockTime } from "@/lib/moments";

/**
 * The portal's clock line (hr.md "Employee portal"): "Clocked in at 7:04 AM MST" on the company's
 * clock in 12-hour time with the zone named (ADR 0064, click-through #66), or that nobody is clocked in.
 */
export function clockedInText(clockedInAt: string | null, zone: string): string {
  return clockedInAt ? `Clocked in at ${formatClockTime(clockedInAt, zone)}` : "You are not clocked in.";
}
