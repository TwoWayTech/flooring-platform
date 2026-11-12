import { Resend } from "resend";
import type { EmailMessage, EmailProvider, SentEmail } from "./types";

/** The part of the Resend client this adapter uses, so tests can pass a fake. */
export type ResendEmails = Pick<Resend["emails"], "send">;

/** Email through Resend (blueprint stack table). */
export class ResendEmailProvider implements EmailProvider {
  private readonly emails: ResendEmails;

  constructor(apiKey: string, emails?: ResendEmails) {
    this.emails = emails ?? new Resend(apiKey).emails;
  }

  /** Sends one message; Resend reports failures as a value, which this turns into an error. */
  async send(message: EmailMessage): Promise<SentEmail> {
    const { data, error } = await this.emails.send(
      {
        from: message.from,
        to: message.to,
        replyTo: message.replyTo,
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments: message.attachments?.map((file) => ({
          filename: file.fileName,
          content: typeof file.content === "string" ? file.content : Buffer.from(file.content),
          contentType: file.contentType,
        })),
      },
      message.idempotencyKey ? { idempotencyKey: message.idempotencyKey } : undefined,
    );
    if (error || !data) throw new Error(`Resend refused the message: ${error?.message ?? "no id returned"}.`);
    return { id: data.id };
  }
}
