import { type FeatureKey, type PermissionKey, type ProductKey } from "@workspace/shared";

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
      say: "Today's sales, open quotes and what needs attention, all computed from documents.",
      href: "/",
      anyOf: ["dashboard.overview.view"],
    },
    {
      title: "Cut a roll",
      say: "Every cut has a source: open a roll, Cut roll, New invoice; once the deposit is in, cut it from the invoice's Stock panel.",
      href: "/inventory?view=rolls",
      anyOf: ["inventory.roll.view"],
    },
    {
      title: "Quote a job",
      say: "Draw a room, add carpet and labor; tax follows the job-site state.",
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
      title: "Receivables",
      say: "Open a customer for their statement and aging buckets.",
      href: "/sales?view=customers",
      anyOf: ["customers.customer.view"],
    },
    {
      title: "Purchasing",
      say: "Receive part of a purchase order, enter the supplier's bill against it, then pay it with proof.",
      href: "/purchasing?view=orders",
      anyOf: ["purchasing.order.view"],
    },
    {
      title: "Installation",
      say: "Crews by day; a job card shows materials, labor and margin.",
      href: "/installation",
      anyOf: ["installation.job.view"],
    },
    {
      title: "Reports",
      say: "Profit and loss and sales tax by jurisdiction, exported to CSV or PDF.",
      href: "/reports",
      anyOf: ["reports.financial.view", "reports.sales.view", "reports.tax.view", "reports.inventory.view"],
    },
    {
      title: "Meetings",
      say: "Recurring meetings with staff, customers and suppliers, with reminders.",
      href: "/meetings",
      anyOf: ["meetings.meeting.view"],
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
      say: "People and hours this week, headcount and upcoming time off.",
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
      say: "California workers earn daily overtime after 8 hours.",
      href: "/hr/timesheets",
      anyOf: ["hr.timesheet.view"],
    },
    {
      title: "Time off",
      say: "Approve or deny a request; the decision lands in the audit log.",
      href: "/hr/time-off",
      anyOf: ["hr.pto.view"],
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
      title: "Audit log",
      say: "Every change made above, with who, when, before and after.",
      href: "/settings/audit",
      anyOf: ["settings.audit.view"],
    },
  ],
};
