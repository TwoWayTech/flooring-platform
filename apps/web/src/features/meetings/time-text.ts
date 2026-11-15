/** "9:00 AM" from an ISO date-time, read as the wall time it already is (meetings keep their zone's time, ADR 0018). */
export function timeOf(iso: string): string {
  const [h, m] = iso.slice(11, 16).split(":").map(Number) as [number, number];
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
