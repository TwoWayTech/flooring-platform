import type { NotificationChannels, NotificationEventKey } from "../types/notifications";

/** Groups of the settings list. */
export const NOTIFICATION_GROUPS = {
  sales: "Sales and invoices",
  purchasing: "Purchasing",
  hr: "People",
  meetings: "Meetings",
  contracts: "Contracts",
  system: "System",
} as const;

/** One template variable: the sample shown in a preview when no real record is around. */
export interface TemplateVariable {
  label: string;
  sample: string;
}

/** A catalogue entry: what the event is, who gets it, and the wording it starts with (ADR 0020). */
export interface NotificationEvent {
  key: NotificationEventKey;
  group: keyof typeof NOTIFICATION_GROUPS;
  label: string;
  /** External events go to people outside the company. */
  audience: "external" | "internal";
  /** Who receives it, in words, for the settings page. */
  goesTo: string;
  channels: NotificationChannels;
  subject: string;
  body: string;
  variables: Record<string, TemplateVariable>;
  attachment: "pdf" | "ics" | null;
  /** Pay, commission and private meetings: redacted in the Outbox, no amounts in the message. */
  restricted?: boolean;
}

const COMPANY: Record<string, TemplateVariable> = {
  "company.name": { label: "Company name", sample: "Summit Floor Co." },
};

const event = (e: NotificationEvent): NotificationEvent => ({
  ...e,
  variables: { ...COMPANY, ...e.variables },
});

/**
 * The event catalogue (spec A4, ADR 0020). Each event names its recipients, because the spec's
 * list needs a recipient rule; tokens are plain names, never expressions, and sensitive values
 * (cost, margin, pay rate, credit limit, pay amounts) are not offered as variables.
 */
export const NOTIFICATION_EVENTS: readonly NotificationEvent[] = [
  event({
    key: "quote.sent",
    group: "sales",
    label: "Quote sent",
    audience: "external",
    goesTo: "The customer",
    channels: { email: true, inApp: false },
    subject: "Your quote {{ quote.number }} from {{ company.name }}",
    body: "Hello {{ customer.name }},\n\nYour quote {{ quote.number }} for {{ quote.total }} is attached. It is valid until {{ quote.expires }}.",
    variables: {
      "customer.name": { label: "Customer", sample: "Alpine Ridge Builders" },
      "quote.number": { label: "Quote number", sample: "Q-2301" },
      "quote.total": { label: "Quote total", sample: "$4,120.50" },
      "quote.expires": { label: "Valid until", sample: "Dec 10, 2026" },
    },
    attachment: "pdf",
  }),
  event({
    key: "invoice.sent",
    group: "sales",
    label: "Invoice sent",
    audience: "external",
    goesTo: "The customer",
    channels: { email: true, inApp: false },
    subject: "Invoice {{ invoice.number }} from {{ company.name }}",
    body: "Hello {{ customer.name }},\n\nInvoice {{ invoice.number }} for {{ invoice.total }} is attached. It is due {{ invoice.due }}.",
    variables: {
      "customer.name": { label: "Customer", sample: "Alpine Ridge Builders" },
      "invoice.number": { label: "Invoice number", sample: "INV-1221" },
      "invoice.total": { label: "Invoice total", sample: "$4,120.50" },
      "invoice.due": { label: "Due date", sample: "Dec 10, 2026" },
    },
    attachment: "pdf",
  }),
  event({
    key: "payment.receipt",
    group: "sales",
    label: "Payment receipt",
    audience: "external",
    goesTo: "The customer",
    channels: { email: true, inApp: false },
    subject: "Receipt for your payment on {{ invoice.number }}",
    body: "Hello {{ customer.name }},\n\nThank you. We received {{ payment.amount }} on invoice {{ invoice.number }}. The remaining balance is {{ invoice.balance }}.",
    variables: {
      "customer.name": { label: "Customer", sample: "Alpine Ridge Builders" },
      "invoice.number": { label: "Invoice number", sample: "INV-1221" },
      "invoice.balance": { label: "Remaining balance", sample: "$2,060.25" },
      "payment.amount": { label: "Payment amount", sample: "$2,060.25" },
    },
    attachment: "pdf",
  }),
  event({
    key: "payment.to_verify",
    group: "sales",
    label: "Payment to verify",
    audience: "internal",
    goesTo: "People who can approve payments",
    channels: { email: false, inApp: true },
    subject: "Payment to verify on {{ document.number }}",
    body: "{{ actor.name }} recorded {{ payment.amount }} on {{ document.number }}. It needs a second person to check the proof.",
    variables: {
      "actor.name": { label: "Recorded by", sample: "Grace Liu" },
      "document.number": { label: "Invoice or bill number", sample: "INV-1221" },
      "payment.amount": { label: "Payment amount", sample: "$2,060.25" },
    },
    attachment: null,
  }),
  event({
    key: "po.sent",
    group: "purchasing",
    label: "Supplier purchase order sent",
    audience: "external",
    goesTo: "The sales rep on the order",
    channels: { email: true, inApp: false },
    subject: "Purchase order {{ po.number }} from {{ company.name }}",
    body: "Hello {{ contact.name }},\n\nPlease find purchase order {{ po.number }} attached, for delivery by {{ po.expected }}.",
    variables: {
      "contact.name": { label: "Sales rep", sample: "Sonny Heller" },
      "po.number": { label: "Order number", sample: "PO-3057" },
      "po.expected": { label: "Expected date", sample: "Nov 20, 2026" },
    },
    attachment: "pdf",
  }),
  event({
    key: "timesheet.submitted",
    group: "hr",
    label: "Timesheet submitted",
    audience: "internal",
    goesTo: "The manager, else HR",
    channels: { email: false, inApp: true },
    subject: "Timesheet from {{ employee.name }} to approve",
    body: "{{ employee.name }} submitted the timesheet for the week of {{ timesheet.week }}.",
    variables: {
      "employee.name": { label: "Employee", sample: "Bri Alvarez" },
      "timesheet.week": { label: "Week", sample: "Nov 2, 2026" },
    },
    attachment: null,
  }),
  event({
    key: "timesheet.decided",
    group: "hr",
    label: "Timesheet approved or rejected",
    audience: "internal",
    goesTo: "The employee",
    channels: { email: true, inApp: true },
    subject: "Your timesheet for {{ timesheet.week }} was {{ timesheet.decision }}",
    body: "Hello {{ employee.name }},\n\nYour timesheet for the week of {{ timesheet.week }} was {{ timesheet.decision }}. {{ timesheet.reason }}",
    variables: {
      "employee.name": { label: "Employee", sample: "Bri Alvarez" },
      "timesheet.week": { label: "Week", sample: "Nov 2, 2026" },
      "timesheet.decision": { label: "Decision", sample: "approved" },
      "timesheet.reason": { label: "Reason, if rejected", sample: "" },
    },
    attachment: null,
  }),
  event({
    key: "timeoff.requested",
    group: "hr",
    label: "Time off requested",
    audience: "internal",
    goesTo: "The manager, else HR",
    channels: { email: true, inApp: true },
    subject: "Time off request from {{ employee.name }}",
    body: "{{ employee.name }} asked for {{ timeoff.kind }} from {{ timeoff.start }} to {{ timeoff.end }}.",
    variables: {
      "employee.name": { label: "Employee", sample: "Bri Alvarez" },
      "timeoff.kind": { label: "Kind", sample: "vacation" },
      "timeoff.start": { label: "First day", sample: "Dec 8, 2026" },
      "timeoff.end": { label: "Last day", sample: "Dec 12, 2026" },
    },
    attachment: null,
  }),
  event({
    key: "timeoff.decided",
    group: "hr",
    label: "Time off decided",
    audience: "internal",
    goesTo: "The employee",
    channels: { email: true, inApp: true },
    subject: "Your time off from {{ timeoff.start }} was {{ timeoff.decision }}",
    body: "Hello {{ employee.name }},\n\nYour request from {{ timeoff.start }} to {{ timeoff.end }} was {{ timeoff.decision }}. {{ timeoff.reason }}",
    variables: {
      "employee.name": { label: "Employee", sample: "Bri Alvarez" },
      "timeoff.start": { label: "First day", sample: "Dec 8, 2026" },
      "timeoff.end": { label: "Last day", sample: "Dec 12, 2026" },
      "timeoff.decision": { label: "Decision", sample: "approved" },
      "timeoff.reason": { label: "Reason, if declined", sample: "" },
    },
    attachment: null,
  }),
  event({
    key: "commission.ready",
    group: "hr",
    label: "Commission statement ready",
    audience: "internal",
    goesTo: "The sales rep",
    channels: { email: true, inApp: true },
    subject: "Your commission statement for {{ statement.month }} is ready",
    body: "Hello {{ employee.name }},\n\nYour commission statement for {{ statement.month }} is ready to view.",
    variables: {
      "employee.name": { label: "Employee", sample: "Priya Natarajan" },
      "statement.month": { label: "Month", sample: "October 2026" },
    },
    attachment: null,
    restricted: true,
  }),
  event({
    key: "meeting.invite",
    group: "meetings",
    label: "Meeting invitation, update or cancellation",
    audience: "external",
    goesTo: "Each guest",
    channels: { email: true, inApp: true },
    subject: "{{ meeting.action }}: {{ meeting.title }}",
    body: "{{ meeting.action }}: {{ meeting.title }}\nWhen: {{ meeting.when }}\nWhere: {{ meeting.location }}\nOrganiser: {{ meeting.organiser }}",
    variables: {
      "meeting.action": { label: "Invitation, Updated or Cancelled", sample: "Invitation" },
      "meeting.title": { label: "Title", sample: "Showroom walkthrough" },
      "meeting.when": { label: "Date and time", sample: "Nov 12, 2026, 10:00 AM" },
      "meeting.location": { label: "Place", sample: "Summit Design Studio" },
      "meeting.organiser": { label: "Organiser", sample: "Dana Whitfield" },
    },
    attachment: "ics",
  }),
  event({
    key: "meeting.reminder",
    group: "meetings",
    label: "Meeting reminder",
    audience: "external",
    goesTo: "Each guest",
    channels: { email: true, inApp: true },
    subject: "Reminder: {{ meeting.title }}",
    body: "A reminder for {{ meeting.title }} at {{ meeting.when }}, {{ meeting.location }}.",
    variables: {
      "meeting.title": { label: "Title", sample: "Showroom walkthrough" },
      "meeting.when": { label: "Date and time", sample: "Nov 12, 2026, 10:00 AM" },
      "meeting.location": { label: "Place", sample: "Summit Design Studio" },
    },
    attachment: null,
  }),
  event({
    key: "meeting.reply",
    group: "meetings",
    label: "Reply to a meeting received",
    audience: "internal",
    goesTo: "The organiser",
    channels: { email: true, inApp: true },
    subject: "{{ guest.name }} replied {{ guest.reply }}: {{ meeting.title }}",
    body: "{{ guest.name }} replied {{ guest.reply }} to {{ meeting.title }}.",
    variables: {
      "guest.name": { label: "Guest", sample: "Alpine Ridge Builders" },
      "guest.reply": { label: "Reply", sample: "accepted" },
      "meeting.title": { label: "Title", sample: "Showroom walkthrough" },
    },
    attachment: null,
  }),
  event({
    key: "meeting.proposed",
    group: "meetings",
    label: "New time proposed",
    audience: "internal",
    goesTo: "The organiser",
    channels: { email: true, inApp: true },
    subject: "{{ guest.name }} proposed a new time for {{ meeting.title }}",
    body: "{{ guest.name }} proposed {{ meeting.when }} for {{ meeting.title }}.",
    variables: {
      "guest.name": { label: "Guest", sample: "Alpine Ridge Builders" },
      "meeting.title": { label: "Title", sample: "Showroom walkthrough" },
      "meeting.when": { label: "Proposed time", sample: "Nov 13, 2026, 2:00 PM" },
    },
    attachment: null,
  }),
  event({
    key: "meeting.requested",
    group: "meetings",
    label: "Meeting requested",
    audience: "internal",
    goesTo: "The person asked",
    channels: { email: true, inApp: true },
    subject: "{{ actor.name }} asked to meet: {{ meeting.title }}",
    body: "{{ actor.name }} asked to meet about {{ meeting.title }} at {{ meeting.when }}.",
    variables: {
      "actor.name": { label: "Asked by", sample: "Bri Alvarez" },
      "meeting.title": { label: "Title", sample: "Quarterly review" },
      "meeting.when": { label: "Time", sample: "Nov 13, 2026, 2:00 PM" },
    },
    attachment: null,
  }),
  event({
    key: "contract.signature",
    group: "contracts",
    label: "Contract sent for signature",
    audience: "external",
    goesTo: "The other party's signer",
    channels: { email: true, inApp: false },
    subject: "Please sign contract {{ contract.number }}",
    body: "Hello {{ party.name }},\n\nContract {{ contract.number }}, {{ contract.title }}, is ready for your signature.",
    variables: {
      "party.name": { label: "Other party", sample: "Alpine Ridge Builders" },
      "contract.number": { label: "Contract number", sample: "CTR-1001" },
      "contract.title": { label: "Title", sample: "Ridgeline condos, phase 2" },
    },
    attachment: "pdf",
  }),
  event({
    key: "contract.expiring",
    group: "contracts",
    label: "Contract or insurance expiring",
    audience: "internal",
    goesTo: "The contract owner and Owners",
    channels: { email: true, inApp: true },
    subject: "{{ contract.number }}: {{ reminder.what }} on {{ reminder.date }}",
    body: "{{ contract.number }}, {{ contract.title }}: {{ reminder.what }} on {{ reminder.date }}.",
    variables: {
      "contract.number": { label: "Contract number", sample: "CTR-1001" },
      "contract.title": { label: "Title", sample: "Ridgeline condos, phase 2" },
      "reminder.what": { label: "What is due", sample: "the insurance certificate expires" },
      "reminder.date": { label: "Date", sample: "Dec 1, 2026" },
    },
    attachment: null,
  }),
  event({
    key: "milestone.invoiced",
    group: "contracts",
    label: "Milestone invoiced",
    audience: "external",
    goesTo: "The customer",
    channels: { email: true, inApp: false },
    subject: "Invoice {{ invoice.number }} for {{ contract.title }}",
    body: "Hello {{ party.name }},\n\nInvoice {{ invoice.number }} for {{ invoice.total }} covers work on {{ contract.title }}.",
    variables: {
      "party.name": { label: "Customer", sample: "Alpine Ridge Builders" },
      "invoice.number": { label: "Invoice number", sample: "INV-1240" },
      "invoice.total": { label: "Invoice total", sample: "$35,043.00" },
      "contract.title": { label: "Contract", sample: "Ridgeline condos, phase 2" },
    },
    attachment: "pdf",
  }),
  event({
    key: "delivery.failed",
    group: "system",
    label: "Email delivery failed",
    audience: "internal",
    goesTo: "The person who caused it, and Outbox viewers",
    channels: { email: false, inApp: true },
    subject: "An email to {{ recipient.name }} could not be delivered",
    body: 'The email "{{ message.subject }}" to {{ recipient.name }} could not be delivered: {{ message.problem }}.',
    variables: {
      "recipient.name": { label: "Recipient", sample: "Alpine Ridge Builders" },
      "message.subject": { label: "Subject", sample: "Invoice INV-1221 from Summit Floor Co." },
      "message.problem": { label: "What went wrong", sample: "no email address on file" },
    },
    attachment: null,
  }),
];

const BY_KEY = new Map(NOTIFICATION_EVENTS.map((e) => [e.key, e]));

/** One event of the catalogue. */
export function notificationEvent(key: NotificationEventKey): NotificationEvent {
  return BY_KEY.get(key)!;
}
