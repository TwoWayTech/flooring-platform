"use client";

import { toast } from "sonner";
import type { OutboxMessage } from "@workspace/shared";
import { api } from "@/lib/api";
import type { ReplyInput } from "@/lib/api/contract";
import { useApiQuery } from "@/lib/api/use-api";
import { ReplyButtons } from "./meeting-answers";
import { offersSimulateReply } from "./meeting-rights";

/**
 * Simulate reply on a meeting invite in the Outbox (spec E): stands in for the guest's own email.
 * Hidden with `meetings.invites` off, which the store refuses (`offersSimulateReply`).
 */
export function SimulateReply({ message, onDone }: { message: OutboxMessage; onDone: () => void }) {
  const invite = offersSimulateReply(message);
  const meeting = useApiQuery(
    (client) => (invite ? client.get("meetings", message.sourceId) : Promise.resolve(undefined)),
    [message.sourceId, invite],
  );
  if (!invite || !meeting.data || meeting.data.status === "cancelled") return null;

  async function send(reply: ReplyInput, done: string) {
    try {
      await api.simulateReply(message.id, reply);
      toast.success(`${message.recipient.name}: ${done}`);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work.");
    }
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <p className="font-medium">Simulate reply from {message.recipient.name}</p>
      <ReplyButtons meeting={meeting.data} send={(reply, done) => void send(reply, done)} />
    </div>
  );
}
