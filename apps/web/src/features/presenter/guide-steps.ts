import { californiaPayOn, type FeatureKey, type PermissionKey, type ProductKey } from "@workspace/shared";

/** One step of the demo: the screen to open and what to show there (spec Tier 3 "Presenter guide"). */
export interface GuideStep {
  title: string;
  /** What to do or point out on the screen, in one sentence. */
  say: string;
  href: string;
  /** The screen needs any one of these; a role without them sees the step greyed out. */
  anyOf: PermissionKey[];
  /** The feature behind a step whose screen does not tell it, such as View as on an ordinary page. */
  feature?: FeatureKey;
}

const VIEW_AS: PermissionKey[] = ["settings.roles.manage"];

/** The demo path per product host, in presenting order. docs/demo-script.md follows the same order. */
export const GUIDE_STEPS: Record<ProductKey, GuideStep[]> = {
  flooring: [
    {
      title: "Dashboard",
      say: "Pick a period: figure cards with their change and trend, receivables, payments to verify and best sellers, all computed from documents.",
      href: "/",
      anyOf: ["dashboard.overview.view"],
    },
    {
      title: "Quote a job",
      say: "Choose the warehouse, draw a room, add flooring and labor; tax follows the job-site state. Save as draft, then Send: the quote is Pending until accepted.",
      href: "/sales/quotes/new",
      anyOf: ["sales.quote.create"],
    },
    {
      title: "Invoice and PDF",
      feature: "sales.invoices",
      say: "Convert an accepted quote to an invoice and download its PDF.",
      href: "/sales?view=quotes",
      anyOf: ["sales.quote.view"],
    },
    {
      title: "Record a payment with proof",
      feature: "sales.payments",
      say: "On an open invoice, Record payment with the receipt attached; above $1,000 a second person confirms it before the balance drops.",
      href: "/sales?view=invoices",
      anyOf: ["sales.payment.view"],
    },
    {
      title: "Cut a roll",
      say: "Every cut has a source: once the deposit is in, cut it from the invoice's Stock panel.",
      href: "/inventory?view=rolls",
      anyOf: ["inventory.roll.view"],
    },
    {
      title: "Receivables",
      say: "Current, Overdue and Due in the next 7 days, with Overdue only; open a customer for their statement.",
      href: "/sales?view=customers",
      anyOf: ["customers.customer.view"],
    },
    {
      title: "Purchasing",
      say: "Find or add a supplier and its sales rep, put a warehouse on each line and order in square feet; then receive, enter the bill and pay with proof.",
      href: "/purchasing?view=orders",
      anyOf: ["purchasing.order.view"],
    },
    {
      title: "Contracts",
      feature: "contracts.register",
      say: "Open CTR-1001: schedule of values, billing with retainage held, change orders, lien waivers and insurance.",
      href: "/contracts",
      anyOf: ["contracts.contract.view"],
    },
    {
      title: "Expenses",
      feature: "finance.expenses",
      say: "Rent, utilities and repairs per location, with a receipt and approval; Manage recurring makes a draft each period.",
      href: "/finance?view=expenses",
      anyOf: ["finance.expense.view"],
    },
    {
      title: "Business report",
      feature: "reports.business",
      say: "One report from revenue to profit by location: click a figure for its records, then export CSV or PDF.",
      href: "/reports",
      anyOf: ["reports.financial.view"],
    },
    {
      title: "Meetings",
      say: "Add a guest by email and schedule. Drag a meeting to a new time; a repeating one asks this, following or all, and Undo puts it back.",
      href: "/meetings",
      anyOf: ["meetings.meeting.view"],
    },
    {
      title: "Outbox",
      feature: "settings.outbox",
      say: "Every email the system would send, with its calendar file. Nothing leaves the demo.",
      href: "/settings/outbox",
      anyOf: ["settings.outbox.view"],
    },
    {
      title: "Pay periods",
      feature: "hr.pay-periods",
      say: "Gross pay by workweek on the regular rate, approved and exported for the payroll provider.",
      href: "/hr/pay-periods",
      anyOf: ["hr.payroll.view"],
    },
    {
      title: "Commissions",
      feature: "hr.commissions",
      say: "Plans with tiers, monthly statements and clawbacks. Approving a statement freezes that month.",
      href: "/hr/commissions",
      anyOf: ["hr.commission.view"],
    },
    {
      title: "Sales team",
      feature: "sales.team",
      say: "Sales, paid revenue and commission per salesperson for the period.",
      href: "/sales?view=team",
      anyOf: ["sales.commission.view"],
    },
    {
      title: "Data import",
      feature: "settings.import",
      say: "Bring customers over from CSV or Excel: columns match by name, the dry run marks bad cells, and each import can be undone.",
      href: "/settings/import",
      anyOf: ["settings.import.manage"],
    },
    {
      title: "View as Sales",
      feature: "shell.view-as",
      say: "In the sidebar, pick View as, then Sales: costs and margins disappear.",
      href: "/inventory",
      anyOf: VIEW_AS,
    },
    {
      title: "Security roles",
      say: "Try to grant a permission you do not hold: the change is blocked.",
      href: "/settings/roles",
      anyOf: ["settings.roles.view", "settings.roles.manage"],
    },
    {
      title: "Number format",
      say: "Change decimals: the display changes, the totals do not.",
      href: "/settings/number-format",
      anyOf: ["settings.numbers.manage"],
    },
    {
      title: "Branding",
      say: "Change the brand color: buttons, links, the floor pattern and charts follow at once.",
      href: "/settings/branding",
      anyOf: ["settings.branding.manage"],
    },
    {
      title: "Audit log",
      say: "Every change made above, with who, when, before and after.",
      href: "/settings/audit",
      anyOf: ["settings.audit.view"],
    },
  ],
  hr: [
    {
      title: "HR dashboard",
      say: "What needs action first, then people and hours this week, headcount and upcoming time off.",
      href: "/",
      anyOf: ["hr.overview.view"],
    },
    {
      title: "Employees",
      say: "Pay rates show only to roles allowed to see them.",
      href: "/hr/employees",
      anyOf: ["hr.employee.view"],
    },
    {
      title: "Timesheets",
      // California rules only behind their switch (ADR 0050).
      say: `${californiaPayOn() ? "California workers earn daily overtime after 8 hours." : "Overtime follows the federal weekly rule."} Approve many at once, or upload hours from the template.`,
      href: "/hr/timesheets",
      anyOf: ["hr.timesheet.view"],
    },
    {
      title: "Time off",
      say: "Approve or deny a request; the hours post to the balance and the decision lands in the audit log.",
      href: "/hr/time-off",
      anyOf: ["hr.pto.view"],
    },
    {
      title: "Pay periods",
      feature: "hr.pay-periods",
      say: "Gross pay by workweek on the regular rate. Approve the run, then export it for the payroll provider.",
      href: "/hr/pay-periods",
      anyOf: ["hr.payroll.view"],
    },
    {
      title: "My portal",
      feature: "hr.portal",
      say: "What every employee sees: their own hours, time off, pay and documents.",
      href: "/my",
      anyOf: ["hr.portal.view"],
    },
    {
      title: "Meetings",
      say: "Payroll close and recruiter standups, repeating on the calendar.",
      href: "/meetings",
      anyOf: ["meetings.meeting.view"],
    },
    {
      title: "Users",
      say: "The seat limit and the last Owner rule cannot be broken.",
      href: "/settings/users",
      anyOf: ["settings.users.view", "settings.users.manage"],
    },
    {
      title: "View as Employee",
      feature: "shell.view-as",
      say: "In the sidebar, pick View as, then Employee: only their own timesheets and time off remain.",
      href: "/hr/timesheets",
      anyOf: VIEW_AS,
    },
    {
      title: "Data import",
      feature: "settings.import",
      say: "Bring employees over from a spreadsheet; a second import updates them by email instead of adding twice.",
      href: "/settings/import",
      anyOf: ["settings.import.manage"],
    },
    {
      title: "Audit log",
      say: "Every change made above, with who, when, before and after.",
      href: "/settings/audit",
      anyOf: ["settings.audit.view"],
    },
  ],
};
