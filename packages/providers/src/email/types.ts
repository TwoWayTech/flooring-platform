/** A file sent with an email: a PDF document or an .ics invitation. */
export interface EmailAttachment {
  fileName: string;
  content: Uint8Array | string;
  contentType: string;
}

/** One email to send. The Outbox sends one message per recipient (ADR 0020). */
export interface EmailMessage {
  from: string;
  to: string[];
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
  /** The Outbox row's dedupe key, so a retry never sends the same email twice. */
  idempotencyKey?: string;
}

/** What the provider returns for a message it accepted. */
export interface SentEmail {
  id: string;
}

/**
 * Sends email (blueprint "Provider portability", rule 4). Templates are rendered before this
 * call, so changing provider (Resend, SES, Azure) never changes a template.
 */
export interface EmailProvider {
  send(message: EmailMessage): Promise<SentEmail>;
}
