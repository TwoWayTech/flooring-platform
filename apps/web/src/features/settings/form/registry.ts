/**
 * Every setting a person can change, with the label and helper line its row shows and the page
 * it lives on (spec A4). Rows read their text from here, and the settings search searches here,
 * so the two never disagree.
 */

/** What a settings row shows and where it lives. */
export interface SettingInfo {
  label: string;
  helper: string;
  href: string;
}

const REGION = "/settings/localization?tab=region";
const CURRENCY = "/settings/localization?tab=currency";
const TAX = "/settings/localization?tab=tax";
const PAYROLL = "/settings/localization?tab=payroll";
const DOCUMENTS = "/settings/documents";
const NUMBERS = "/settings/number-format";
const BRANDING = "/settings/branding";
const PROFILE = "/settings/company";
const PAYMENTS = "/settings/payments";
const LOCATIONS = "/settings/locations";
const HR = "/settings/hr";
const MEETINGS = "/settings/meetings";
const EXPENSES = "/settings/expenses";

export const SETTINGS = {
  "region.country": { label: "Country", helper: "The US pack: 50 states and DC, imperial units, USD.", href: REGION },
  "region.primaryState": {
    label: "Primary state",
    helper: "Where the company is based; new quotes start with this job-site state.",
    href: REGION,
  },
  "region.timeZone": {
    label: "Time zone",
    helper: "Dates, reminders and today's jobs follow this zone.",
    href: REGION,
  },
  "region.dateFormat": { label: "Date format", helper: "How dates read on every screen and document.", href: REGION },
  "region.firstDayOfWeek": {
    label: "Week starts on",
    helper: "The first day of calendars and timesheets.",
    href: REGION,
  },
  "region.fiscalYearStartMonth": {
    label: "Fiscal year starts",
    helper: "Year-to-date figures and reports count from this month.",
    href: REGION,
  },
  "region.statesOfOperation": {
    label: "States of operation",
    helper: "Where you sell; the company default tax rate applies only in these states.",
    href: REGION,
  },
  "currency.base": { label: "Base currency", helper: "Locked after the first posted document.", href: CURRENCY },
  "currency.extra": {
    label: "Other currencies",
    helper: "Rates per 1 USD for bills from abroad; amounts are always stored in USD.",
    href: CURRENCY,
  },
  "tax.pricesInclude": {
    label: "Prices are",
    helper: "Whether prices in the catalog already include sales tax.",
    href: TAX,
  },
  "tax.rounding": { label: "Round tax", helper: "Round on each line, or once on the document total.", href: TAX },
  "tax.rules": {
    label: "Rules by state",
    helper: "What is taxable where, at which rate. Every rule is an example: confirm with your accountant.",
    href: TAX,
  },
  "tax.companyDefault": {
    label: "Company default rate",
    helper: "Applies in your states of operation that have no state rule; elsewhere tax is not collected.",
    href: TAX,
  },
  "tax.jurisdictions": {
    label: "County rates",
    helper: "Replace the state rate for job sites in one county, from a start date.",
    href: TAX,
  },
  "payroll.overtimeRule": {
    label: "Overtime rule",
    helper: "Workers in California follow the California rule whatever is chosen here.",
    href: PAYROLL,
  },
  "payroll.holidayState": {
    label: "Holiday calendar",
    helper: "The state whose public holidays timesheets skip.",
    href: PAYROLL,
  },
  "expenses.approvalRequired": {
    label: "Approve larger expenses",
    helper: "Expenses above the amount wait for a second person.",
    href: EXPENSES,
  },
  "expenses.approvalThreshold": { label: "Approval above", helper: "Cost including tax.", href: EXPENSES },
  "sharedCosts.rule": {
    label: "How company-wide costs are shared",
    helper: "Used for each location's profit in the business report.",
    href: EXPENSES,
  },
  "meetings.defaultReminderMin": {
    label: "Default reminder",
    helper: "New meetings start with this reminder.",
    href: MEETINGS,
  },
  "meetings.newGuestHandling": {
    label: "New guests added by email",
    helper: "Whether someone new is kept, and how.",
    href: MEETINGS,
  },
  "meetings.allowProposals": {
    label: "Guests can propose a new time",
    helper: "On one-off meetings only.",
    href: MEETINGS,
  },
  "meetings.hideGuestList": {
    label: "Hide guest lists by default",
    helper: "Each guest sees only themselves on the invite.",
    href: MEETINGS,
  },
  "hr.workweekStartDay": {
    label: "Workweek starts on",
    helper: "Overtime is worked out on this fixed seven-day week.",
    href: HR,
  },
  "hr.payFrequency": { label: "Pay frequency", helper: "How often pay periods close.", href: HR },
  "hr.showPayToEmployees": { label: "Show pay to employees", helper: "Adds My pay to the portal.", href: HR },
  "hr.showCommissionToEmployees": {
    label: "Show commission to employees",
    helper: "The company default. Each person can be set differently on their profile.",
    href: HR,
  },
  "hr.showRatesToEmployees": { label: "Show pay rate to employees", helper: "Adds the rate to My profile.", href: HR },
  "hr.showTeamCalendarToEmployees": {
    label: "Show who is out to employees",
    helper: "They see that someone is out, never why.",
    href: HR,
  },
  "hr.clockEnabled": {
    label: "Clock in and out",
    helper: "Adds a clock to the portal; punches fill the timesheet.",
    href: HR,
  },
  "documents.defaultTerms": {
    label: "Default payment terms",
    helper: "New customers start with these terms; each customer can have their own.",
    href: DOCUMENTS,
  },
  "documents.lateFeePct": {
    label: "Late fee per month",
    helper: "Shown on overdue invoices and used for a returned-check fee.",
    href: DOCUMENTS,
  },
  "documents.defaultDepositPct": {
    label: "Default deposit on quotes",
    helper: "The share of the total asked for when a quote is accepted.",
    href: DOCUMENTS,
  },
  "documents.balanceDueDays": {
    label: "Balance due after a deposit",
    helper: "Days after issue that the rest of a deposit invoice falls due.",
    href: DOCUMENTS,
  },
  "documents.quoteExpiryDays": {
    label: "Quotes valid for",
    helper: "Days a sent quote stays valid by default; after that it reads Expired.",
    href: DOCUMENTS,
  },
  "documents.defaultWastePct": {
    label: "Default waste per category",
    helper: "New material lines start with this allowance. Customers see the billed quantity only, never the waste.",
    href: DOCUMENTS,
  },
  "documents.quotePrefix": {
    label: "Quote number prefix",
    helper: "New quotes are numbered after it.",
    href: DOCUMENTS,
  },
  "documents.invoicePrefix": {
    label: "Invoice number prefix",
    helper: "New invoices are numbered after it.",
    href: DOCUMENTS,
  },
  "documents.poPrefix": {
    label: "Purchase order prefix",
    helper: "New purchase orders are numbered after it.",
    href: DOCUMENTS,
  },
  "documents.legalFooter": {
    label: "Legal footer",
    helper: "Printed at the bottom of quotes, invoices and receipts.",
    href: DOCUMENTS,
  },
  "inventory.adjustmentApprovalQty": {
    label: "Adjustments that need approval",
    helper: "Above this many ft, sq ft or items, an Owner or Manager approves the change. Empty: never.",
    href: LOCATIONS,
  },
  "email.senderName": {
    label: "Sender name",
    helper: "The name people see in their inbox.",
    href: "/settings/notifications",
  },
  "email.replyTo": {
    label: "Reply-to address",
    helper: "Where replies go.",
    href: "/settings/notifications",
  },
  "email.signature": {
    label: "Sign-off",
    helper: "Added to the end of every email.",
    href: "/settings/notifications",
  },
  "payments.approvalRequired": {
    label: "Payments need approval",
    helper: "A recorded payment waits until someone else with approval permission confirms it.",
    href: PAYMENTS,
  },
  "payments.approvalThreshold": {
    label: "Only above this amount",
    helper: "Smaller payments are confirmed at once. Leave empty to check every payment.",
    href: PAYMENTS,
  },
  "payments.writeOffMax": {
    label: "Largest write-off",
    helper: "Write off remaining balance is offered only up to this amount. Leave empty for no limit.",
    href: PAYMENTS,
  },
  "payments.paymentPrefix": {
    label: "Payment number prefix",
    helper: "Payments are numbered after it, for example PAY-0001.",
    href: PAYMENTS,
  },
  "payments.refundPrefix": {
    label: "Refund number prefix",
    helper: "Refunds of customer credit are numbered after it.",
    href: PAYMENTS,
  },
  "numbers.decimals": {
    label: "Decimals per kind of number",
    helper: "Display only: totals are always calculated at full precision.",
    href: NUMBERS,
  },
  "numbers.negative": { label: "Negative numbers", helper: "How amounts below zero are written.", href: NUMBERS },
  "numbers.compact": {
    label: "Compact dashboard figures",
    helper: "Shows $1.2M instead of $1,234,567 on dashboard cards.",
    href: NUMBERS,
  },
  "branding.displayName": {
    label: "Display name",
    helper: "Shown in the app and on documents.",
    href: BRANDING,
  },
  "branding.monogram": {
    label: "Monogram letters",
    helper: "Two letters shown in place of a logo.",
    href: BRANDING,
  },
  "branding.brandColor": {
    label: "Brand color",
    helper: "Buttons, links and highlights. It must stay readable on panels.",
    href: BRANDING,
  },
  "branding.pattern": { label: "Floor pattern", helper: "The laying pattern behind the sign-in page.", href: BRANDING },
  "branding.logo": {
    label: "Logo",
    helper: "Shown in the sidebar and on documents; the monogram stands in without one.",
    href: BRANDING,
  },
  "branding.defaultTheme": {
    label: "Default theme",
    helper: "Light, dark or the device's own setting, until a person picks one.",
    href: BRANDING,
  },
  "profile.legalName": { label: "Legal name", helper: "As on your tax filings; printed on documents.", href: PROFILE },
  "profile.ein": { label: "EIN", helper: "Federal employer identification number, 12-3456789.", href: PROFILE },
  "profile.address": { label: "Company address", helper: "Printed on quotes, invoices and receipts.", href: PROFILE },
} as const satisfies Record<string, SettingInfo>;

/** The id of one setting, such as "region.timeZone". */
export type SettingId = keyof typeof SETTINGS;

/** The id the control of a setting row uses, so its label and helper point at it. */
export function settingControlId(id: SettingId): string {
  return `setting-${id.replace(/\./g, "-")}`;
}

/** Settings whose label or helper contains every word of the query, for the settings search. */
export function searchSettings(query: string): { id: SettingId; info: SettingInfo }[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return (Object.entries(SETTINGS) as [SettingId, SettingInfo][])
    .filter(([, info]) => {
      const text = `${info.label} ${info.helper}`.toLowerCase();
      return words.every((w) => text.includes(w));
    })
    .map(([id, info]) => ({ id, info }));
}
