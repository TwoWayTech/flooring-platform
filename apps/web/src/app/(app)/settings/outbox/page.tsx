import type { Metadata } from "next";
import { OutboxPage } from "@/features/outbox/outbox-page";

export const metadata: Metadata = { title: "Outbox" };

/** Outbox. */
export default function Page() {
  return <OutboxPage all />;
}
