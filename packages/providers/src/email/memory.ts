import type { EmailMessage, EmailProvider, SentEmail } from "./types";

/** Keeps messages in a list instead of sending them, for tests and local runs. */
export class MemoryEmailProvider implements EmailProvider {
  readonly sent: (EmailMessage & SentEmail)[] = [];

  /** Records the message; a repeated idempotency key returns the first id, as a real provider would. */
  async send(message: EmailMessage): Promise<SentEmail> {
    const earlier = message.idempotencyKey
      ? this.sent.find((sent) => sent.idempotencyKey === message.idempotencyKey)
      : undefined;
    if (earlier) return { id: earlier.id };
    const id = `memory-${this.sent.length + 1}`;
    this.sent.push({ ...message, id });
    return { id };
  }
}
