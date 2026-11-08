/** Flooring screens a presenter can open as Summit's Owner, checked for layout and accessibility. */
export const FLOORING_SCREENS = [
  "/",
  "/inventory",
  "/inventory?view=rolls",
  "/inventory?view=transfers",
  "/inventory/rolls/sm-roll-0004",
  "/sales",
  "/sales?view=invoices",
  "/sales?view=customers",
  "/purchasing?view=orders",
  "/purchasing?view=bills",
  "/installation",
  "/reports",
  "/meetings",
  "/sales/quotes/sm-quo-0288",
  "/sales/quotes/new",
  "/sales/invoices/sm-inv-0150",
  "/settings",
  "/settings/users",
  "/settings/roles",
  "/settings/branding",
  "/settings/localization",
  "/settings/number-format",
  "/settings/company",
  "/settings/locations",
  "/settings/audit",
];

/** HR Suite screens, opened as Harbor Staffing's Owner on the HR host. */
export const HR_SCREENS = ["/", "/hr/employees", "/hr/timesheets", "/hr/time-off", "/meetings"];

/** Platform admin screens. */
export const ADMIN_SCREENS = ["/admin", "/admin/companies/summit"];
