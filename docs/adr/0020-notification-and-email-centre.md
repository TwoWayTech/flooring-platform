# ADR 0020: Notification and email centre with event rules, templates and a simulated Outbox

Date: 2026-11-10. Status: proposed (waiting for the owner's OK on the Phase 0 plan).

## Context
Feature batch 3, section A4 asks for Settings → Email and notifications (sender name, reply-to, and a list of events each with an on/off toggle, a template with variables and a preview), an Outbox of every email the system would send, and a choice per event of in-app, email or both. Purchasing, HR, contracts and meetings all send through it.

Today the demo has no idea of an email. The bell (`apps/web/src/components/shell/notifications.tsx`) and the dashboard's Needs attention panel both read `apps/web/src/lib/attention.ts`, which runs permission-filtered checks and stores nothing, so an item disappears once the work is done (decision K-9 in `docs/specs/feature-batch-02-plan.md`). The demo is front end only and never sends real email; the real build (NestJS, PostgreSQL) sends through an `EmailProvider`.

## What we learned

### Odoo
- A template is a stored record. Placeholders such as `{{ object.partner_id }}` work in the body, the subject, the configuration fields and the language, and a Reset Template button restores the default. ([Odoo 19 email templates](https://www.odoo.com/documentation/19.0/applications/general/companies/email_template.html))
- Odoo warns that editing a template's underlying code can break it at once or at the next upgrade, that faulty syntax in a translation can leave the template blank, and that template customisation is outside its support. ([Odoo 19 email templates](https://www.odoo.com/documentation/19.0/applications/general/companies/email_template.html))
- Delivery state is a field on each message: `outgoing`, `sent`, `received`, `exception` (shown as Delivery Failed) and `cancel`. A separate `failure_type` records the reason, such as invalid email, missing email, invalid From address, mail server failure or spam. ([Odoo source, mail_mail.py](https://raw.githubusercontent.com/odoo/odoo/19.0/addons/mail/models/mail_mail.py))
- A failed email can be retried, which returns it to Outgoing, sent at once, or cancelled, and sent mail is cleared from the queue by a scheduled clean-up. ([Odoo email FAQ](https://www.odoo.com/documentation/19.0/applications/general/email_communication/faq.html))
- The sender learns of a failure on the record itself: an envelope icon turns red when any recipient fails, and opening it shows the error for each recipient. ([Odoo email FAQ](https://www.odoo.com/documentation/19.0/applications/general/email_communication/faq.html))
- With auto-delete on, a mail is removed after sending unless it failed for a reason other than a bad or missing address, so real failures stay reviewable. ([Odoo source, mail_mail.py](https://raw.githubusercontent.com/odoo/odoo/19.0/addons/mail/models/mail_mail.py))
- Each user picks one place for their notifications, Handle by Emails (the default) or Handle in Odoo. ([Odoo Discuss](https://www.odoo.com/documentation/19.0/applications/productivity/discuss.html)) Third-party modules add a "both" option, which suggests the single choice is a felt limit. ([app listing](https://apps.odoo.com/apps/modules/19.0/zv_notify_both), search snippet only)
- Odoo Online caps sending at 5 to 200 emails a day depending on the plan. Every outgoing message counts, and notifying users in-app lowers the count. ([Odoo email FAQ](https://www.odoo.com/documentation/19.0/applications/general/email_communication/faq.html))

### QuickBooks Online
- Automatic invoice reminders have a master switch and a switch per reminder. Each reminder is a number of days, up to 90, before or after the due date, with an editable subject, greeting and message. Variables such as Invoice Number and Company Name exist, but the article gives no full list. ([Invoice reminders](https://quickbooks.intuit.com/learn-support/en-us/help-article/invoicing/send-invoice-reminders-automatically-manually/L84cQjpxo_US_en_US))
- Reminders go only for invoices that were already emailed, and an edited template affects only future reminders. ([Invoice reminders](https://quickbooks.intuit.com/learn-support/en-us/help-article/invoicing/send-invoice-reminders-automatically-manually/L84cQjpxo_US_en_US))
- The email carrying an invoice can show full or summarised details, and the PDF can be attached. ([Customise invoices](https://quickbooks.intuit.com/learn-support/en-global/help-article/sales-receipt-formats/customise-invoices-quickbooks-online/L3n8Z8WVH_ROW_en))
- A failed delivery marks the invoice Undeliverable and surfaces it under Needs Attention, and a separate list gives the date, type, reference, customer, error and delivery method. ([Undelivered invoices](https://quickbooks.intuit.com/learn-support/en-us/help-article/manage-invoices/undelivered-invoices-quickbooks-online/L8dtrsoqY_US_en_US))
- When an invoice goes to several recipients, one failure marks the whole invoice and QuickBooks cannot say which address failed. ([Undelivered invoices](https://quickbooks.intuit.com/learn-support/en-us/help-article/manage-invoices/undelivered-invoices-quickbooks-online/L8dtrsoqY_US_en_US))

### Gusto
Gusto's help site answered our fetches with HTTP 403, so everything in this block comes from search result snippets and was not read on the page itself.
- Time-off requests notify admins unless the employee has a manager, in which case only the manager is emailed. A request entered by a payroll admin emails no admins, and admins marked as external accountants receive none. ([Time-off requests for admins](https://support.gusto.com/article/100395028100000/Manage-time-off-requests-for-admins))
- Employees set their own email, text and push preferences, but account emails, including payday emails, cannot be turned off. ([Employee notification settings](https://support.gusto.com/article/102018295100000/manage-your-notification-settings-for-us-employees-or-contractors))
- Admins choose which account emails they receive in their own settings. ([Admin notification settings](https://support.gusto.com/article/220916120727513/manage-your-notification-settings-for-admins))
- Pay amounts can be hidden in payday emails, set by the admin for the company and changeable by each employee. ([Hide pay amounts](https://support.gusto.com/article/240814190925143/Hide-the-pay-amount-in-payday-emails-for-admins))

### Law and deliverability
- Transactional messages are exempt from most of CAN-SPAM but must not use false or misleading routing information. The FTC reads the transactional categories narrowly, and a mixed message is judged by its subject line and by whether the transactional part comes first. ([FTC CAN-SPAM guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business))
- Commercial email needs an opt-out that is honoured within 10 business days. ([FTC CAN-SPAM guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business))
- Gmail requires SPF or DKIM from all senders and a spam rate below 0.3%. Senders of 5,000 or more messages a day also need DMARC, a From domain aligned with SPF or DKIM, and one-click unsubscribe on marketing mail. ([Google sender guidelines](https://support.google.com/mail/answer/81126?hl=en))

### Not verified
- We could not read any Gusto page directly, and we found no Gusto document on company-wide template editing, so we make no claim that Gusto offers or lacks it.
- We found no full list of QuickBooks reminder variables, and no official description of its in-app notifications.
- Odoo's help does not describe a preview or test-send step for templates in the pages we read.

## Decision
- **Event catalogue in shared code.** `packages/shared/src/notifications/events.ts` lists each event: key, group, label, audience (external or internal), default channels, recipient rule, allowed variables, attachments, and whether email can be switched off. The table below is the catalogue.
- **Company settings.** `EmailSettings` holds `senderName`, `replyTo` and `signature`. `NotificationRule` holds one company's overrides per event (`enabled`, `channels`, `subject`, `body`, `updatedAt`, `updatedBy`); with no rule, the catalogue defaults apply. Editing needs `settings.notifications.manage` (Owner by default).
- **Personal preferences.** `NotificationPreference` lets a user turn email or in-app off per event group, for internal events only. Customer-facing email is a company decision and has no personal switch.
- **Templates.** Only email has templates; in-app text is fixed in the catalogue. Tokens look like `{{ invoice.number }}` and come from the event's allowed list. They are plain names, not expressions, because Odoo's open expressions are what can break a template. The editor rejects an unknown token on save and offers Reset to default. Bodies are plain text with line breaks and links, placed inside a fixed branded layout with no raw HTML.
- **Rendering.** `renderTemplate` in shared code is pure. Values are escaped, money and dates come preformatted by the shared helpers, and a missing value renders empty with a warning in the preview. Preview uses a recent real record of that kind, or a sample if there is none.
- **Sensitive values.** Cost, margin, pay rate and credit limit are never available as variables. Pay and commission emails say the statement is ready and link to it, without amounts, following Gusto's hidden-amount pattern and the view_sensitive rule.
- **Recipient rules.** Each event names who receives it, as in Gusto's routing. Approvals go to the employee's manager, else HR. The person who caused an event is never notified of it.
- **Outbox.** `OutboxMessage` has one row per recipient, because QuickBooks shows that a shared row cannot say who failed. Fields: `id`, `companyId`, `eventKey`, `sourceType`, `sourceId`, `actorUserId`, `recipient` (kind, id, name, email), `fromName`, `replyTo`, `subject`, `bodyText`, `attachments` (kind `pdf` or `ics`, file name, and the `.ics` text or document reference), `status`, `failureType`, `failureDetail`, `createdAt`, `scheduledFor`, `sentAt`, `templateUpdatedAt`, `dedupeKey`. Subject, body and attachments are snapshots, so a later edit never changes what was "sent".
- **Statuses.** `scheduled`, `queued`, `sent`, `failed`, `cancelled`. The stored value is `sent` so the real build can copy it; the demo's screen labels it "Sent (simulated)". `failureType` is one of `missing_email`, `invalid_email`, `provider_error`, `bounced`.
- **Off means no row.** If an event's email channel is off, or the recipient has no address and the rule is off, nothing is written. If the rule is on and the address is missing or invalid, a `failed` row is written and the actor is told in-app, following Odoo's and QuickBooks's habit of surfacing failure where the work happens.
- **Actions.** Open, download attachment, Retry on `failed` (back through `queued` to `sent`), Cancel on `scheduled`, Simulate reply on meeting invites (ADR 0021), and Simulate bounce for presenters.
- **In-app.** `InAppNotification` is stored per user (`userId`, `eventKey`, `title`, `href`, `createdAt`, `readAt`). The bell gains an Updates list with read state above the unchanged, derived Needs attention list.
- **Timing.** The demo has no background worker. Reminders are `scheduled` rows that the store turns to `sent` on the next load after their time passes. `dedupeKey` (event, source, source version, recipient) stops a second row for the same send.
- **Visibility.** `settings.outbox.view` (Owner and admins) shows all rows; everyone else sees rows where they are the recipient or the actor. Rows from pay, commission or a private HR meeting show only recipient and status to anyone who is not a participant and lacks the matching HR permission.
- **Banner.** The Outbox and the settings page always say that the demo sends no real email and that the real product sends through its provider.
- **Feature keys.** `settings.notifications` and `settings.outbox`. New collections: `notificationRules`, `notificationPreferences`, `outboxMessages`, `inAppNotifications`.

| Event | Goes to | Default channels | Attachment |
| --- | --- | --- | --- |
| Quote sent | Customer contact | Email | Quote PDF |
| Invoice sent | Customer contact | Email | Invoice PDF |
| Payment receipt | Customer contact | Email | Receipt PDF |
| Payment to verify | Users who can approve payments | In-app | None |
| Supplier PO sent | Chosen sales rep | Email | PO PDF |
| Timesheet submitted | Manager, else HR | In-app | None |
| Timesheet approved or rejected | Employee | In-app and email | None |
| Time off requested | Manager, else HR | In-app and email | None |
| Time off decided | Employee | In-app and email | None |
| Commission statement ready | Rep | In-app and email | None, no amounts |
| Meeting invitation (invite, update, cancel; one switch) | Each guest | Email; in-app too for staff | `.ics` |
| Meeting reminder | Each guest | Email; in-app for staff | None |
| Meeting reply received (added) | Organiser | In-app and email | None |
| New time proposed (added) | Organiser | In-app and email | None |
| Meeting requested (added) | The person asked | In-app and email | None |
| Contract sent for signature | Other party's signer | Email | Contract PDF |
| Contract expiring | Contract owner and Owner role | In-app and email | None |
| Milestone invoiced | Customer contact | Email | Invoice PDF |
| Email delivery failed (added) | Actor and users with `settings.outbox.view` | In-app | None |

## Where the research changes the spec
1. **"In-app notifications stay" cannot work as written.** The current bell shows derived counts, so it cannot say "your time off was approved". Recommendation: keep Needs attention and add stored per-user notifications with read state.
2. **The event list has no recipients.** Recommendation: add a recipient rule per event, as above, including Gusto's manager-else-admin routing and leaving out the person who acted.
3. **The event list is missing events the flows need.** Recommendation: add meeting reply received, new time proposed, meeting requested, and email delivery failed. The first two follow from RFC 5546's reply path to the organiser (ADR 0021), and the last follows from Odoo's and QuickBooks's failure surfacing.
4. **Separate toggles for invite, update and cancel are unsafe.** RFC 5546 says a cancellation must reach every affected attendee ([section 3.2.5](https://www.rfc-editor.org/rfc/rfc5546#section-3.2.5)). Recommendation: one switch for the three, and a separate one for reminders.
5. **Outbox "admins see all" conflicts with "HR meetings can be private".** Recommendation: the redaction rule above.
6. **Status values are not defined.** Recommendation: the five statuses and failure types above.
7. **Personal preferences are absent.** Odoo and Gusto both have them. Recommendation: a small "My notifications" page for internal events. If the plan needs the smallest scope, this is the first thing to leave for the real build.
8. **Pay and commission emails need a content rule.** Recommendation: no amounts in those emails.
9. **The "preview" needs a data source.** Recommendation: a recent real record of that kind, falling back to a sample.

## Consequences
- The real API uses the same catalogue and `renderTemplate`, with `outbox_messages` in the company database and a background worker that sends queued rows and fires scheduled reminders, with retries.
- `EmailProvider` needs a send call and a delivery webhook, so `sent` can move to delivered or `bounced`. The demo's Simulate bounce marks where that webhook lands.
- Each sending domain needs SPF and DKIM, and at volume DMARC with an aligned From address, per [Google's guidelines](https://support.google.com/mail/answer/81126?hl=en). Customers therefore edit the sender name and reply-to, while the From address stays on a verified domain.
- These emails must stay transactional. Because templates are free text, the editor should warn against promotions at the top of a message, given the FTC's [primary purpose test](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business). Any future marketing email needs an opt-out and a separate path.
- The real build needs a retention period and clean-up, as Odoo has, and should keep failed rows longer than sent ones.
- Provider sending limits should be planned for. Odoo's [daily cap](https://www.odoo.com/documentation/19.0/applications/general/email_communication/faq.html) shows that in-app delivery reduces volume.
- Attachments move to object storage with expiring links instead of inline text.

## Sources
- [Odoo 19: Email templates](https://www.odoo.com/documentation/19.0/applications/general/companies/email_template.html)
- [Odoo 19: Common emailing issues](https://www.odoo.com/documentation/19.0/applications/general/email_communication/faq.html)
- [Odoo 19: Discuss](https://www.odoo.com/documentation/19.0/applications/productivity/discuss.html)
- [Odoo 19 source: mail_mail.py](https://raw.githubusercontent.com/odoo/odoo/19.0/addons/mail/models/mail_mail.py)
- [Odoo app listing: notify both](https://apps.odoo.com/apps/modules/19.0/zv_notify_both) (search snippet only, not opened)
- [QuickBooks: Send invoice reminders](https://quickbooks.intuit.com/learn-support/en-us/help-article/invoicing/send-invoice-reminders-automatically-manually/L84cQjpxo_US_en_US)
- [QuickBooks: Customise invoices](https://quickbooks.intuit.com/learn-support/en-global/help-article/sales-receipt-formats/customise-invoices-quickbooks-online/L3n8Z8WVH_ROW_en)
- [QuickBooks: Fix undelivered invoices](https://quickbooks.intuit.com/learn-support/en-us/help-article/manage-invoices/undelivered-invoices-quickbooks-online/L8dtrsoqY_US_en_US)
- [Gusto: Time-off requests for admins](https://support.gusto.com/article/100395028100000/Manage-time-off-requests-for-admins) (search snippet only; the page returned HTTP 403)
- [Gusto: Employee notification settings](https://support.gusto.com/article/102018295100000/manage-your-notification-settings-for-us-employees-or-contractors) (search snippet only; the page returned HTTP 403)
- [Gusto: Admin notification settings](https://support.gusto.com/article/220916120727513/manage-your-notification-settings-for-admins) (search snippet only; the page returned HTTP 403)
- [Gusto: Hide pay amounts in payday emails](https://support.gusto.com/article/240814190925143/Hide-the-pay-amount-in-payday-emails-for-admins) (search snippet only, not opened)
- [FTC: CAN-SPAM compliance guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)
- [Google: Email sender guidelines](https://support.google.com/mail/answer/81126?hl=en)
- [RFC 5546, section 3.2.5](https://www.rfc-editor.org/rfc/rfc5546#section-3.2.5)
