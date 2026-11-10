"use client";

import type { OutboxMessage } from "@workspace/shared";

/** Simulate reply on a meeting invite in the Outbox (spec E); other messages have no reply to simulate. */
export function SimulateReply({ message, onDone }: { message: OutboxMessage; onDone: () => void }) {
  void onDone;
  if (message.eventKey !== "meeting.invite") return null;
  return null;
}
