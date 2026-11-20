/**
 * Reads a page makes that the API refuses for a role that may open the page, each with how the
 * page handles the refusal (whole-product check, PG-4, ADR 0058). Keyed `<page> <ApiClient call>`.
 * A read the client already softens needs no entry: `seen` and `seenOrOff` in api-methods.ts turn a
 * 403 into an empty list and `orNone` into nothing, which is how every screen shows a list the
 * viewer may not read.
 */
export const TOLERATED_REFUSALS: Readonly<Record<string, string>> = {
  "/ listPayPeriods":
    "The HR part of the dashboard asks for pay periods only when the viewer holds hr.payroll.view (`seesPay`, hr-dashboard.tsx).",
  "/hr listPayPeriods":
    "The HR dashboard asks for pay periods only when the viewer holds hr.payroll.view (`seesPay`, hr-dashboard.tsx).",
  "/reports businessReport":
    "The hub opens only the reports GET /reports/options offers the viewer (reports-page.tsx, ADR 0055); Sales isn't offered this one.",
  "/reports paymentsReport":
    "The hub opens only the reports GET /reports/options offers the viewer (reports-page.tsx, ADR 0055); Sales isn't offered this one.",
  "/reports pnlReport":
    "The hub opens only the reports GET /reports/options offers the viewer (reports-page.tsx, ADR 0055); Sales isn't offered this one.",
  "/reports trialBalance":
    "The hub opens only the reports GET /reports/options offers the viewer (reports-page.tsx, ADR 0055); the trial balance needs company-wide books sight, so Sales isn't offered it.",
};
