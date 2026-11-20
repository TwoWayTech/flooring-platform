/**
 * The reviewed list of money-named float conversions in UI code (whole-product check, UI-1, ADR
 * 0058). Each was read by hand and classed. They are listed and followed up, not fixed here: most
 * sit in money, commission and payroll screens (S-12). A new one fails the money-in-UI test until
 * someone reviews it; one that is gone fails as stale.
 */

/** What a conversion does with the float, which decides how urgent its follow-up is. */
export const FLOAT_USE_CLASSES = {
  "arithmetic shown": {
    meaning: "Adds, subtracts, multiplies or takes the absolute value as JS floats, and shows the result.",
    status: "Proposed STATUS follow-up F-o (rule 6, fix first): compute with decimal.js (packages/shared money).",
  },
  "arithmetic sent": {
    meaning: "Computes a value as JS floats and sends it to the API.",
    status: "Proposed STATUS follow-up F-o (rule 6, fix first): compute with decimal.js (packages/shared money).",
  },
  "sign check": {
    meaning: "Compares with zero only; a decimal string's sign survives the float. Nothing computed is shown.",
    status: "Proposed STATUS follow-up F-o (rule 6, low): compare with decimal.js or the shared helpers.",
  },
  comparison: {
    meaning: "Compares with zero or a fixed threshold to choose a label.",
    status: "Proposed STATUS follow-up F-o (rule 6, low): compare with decimal.js or the shared helpers.",
  },
  "chart or gauge": {
    meaning:
      "Scales a bar, chart, gauge or a count-up animation; the figure itself is shown from the string through formatNumber or <Num>.",
    status: "Proposed STATUS follow-up F-o (rule 6, low): charts need numbers; keep, or scale from decimals.",
  },
  "sort key": {
    meaning: "Orders table rows; nothing computed is shown.",
    status: "Proposed STATUS follow-up F-o (rule 6, low): sort with the shared decimal comparison.",
  },
  "number in the contract": {
    meaning: "The shared type itself holds a number here, so the screen can't avoid it.",
    status: "Proposed STATUS follow-up F-k (rule 6): quantities sent as JSON numbers.",
  },
  "whole number": {
    meaning: "A whole number that is not money: days, or a support grant's hours. Not a rule-6 value.",
    status: "None needed.",
  },
} as const;

/** A class of float use. */
export type FloatUseClass = keyof typeof FLOAT_USE_CLASSES;

/** Each reviewed conversion, keyed as the scan prints it (`<file>: Number(<expr>)`), with its class and why. */
export const KNOWN_FLOAT_USES: Readonly<Record<string, { use: FloatUseClass; why: string }>> = {
  "apps/web/src/features/admin/support-request-dialog.tsx: Number(hours)": {
    use: "whole number",
    why: "How many hours a support request asks for.",
  },
  "apps/web/src/features/dashboard/best-sellers.tsx: Number(value)": {
    use: "chart or gauge",
    why: "Bar widths for the best sellers; the figures are shown with <Num>.",
  },
  "apps/web/src/features/dashboard/figure-card.tsx: Number(change)": {
    use: "arithmetic shown",
    why: "The percent change's sign picks Up or Down, and its absolute value goes through a float before formatNumber.",
  },
  "apps/web/src/features/dashboard/key-figure.tsx: Number(value)": {
    use: "chart or gauge",
    why: "The count-up animation's frames; the settled figure is <Num> from the string.",
  },
  "apps/web/src/features/dashboard/revenue-chart.tsx: Number(m.grossMargin)": {
    use: "chart or gauge",
    why: "Recharts plots numbers; the tooltip formats them.",
  },
  "apps/web/src/features/dashboard/revenue-chart.tsx: Number(m.revenue)": {
    use: "chart or gauge",
    why: "Recharts plots numbers; the tooltip formats them.",
  },
  "apps/web/src/features/dashboard/warehouse-today.tsx: Number(h.quantity)": {
    use: "sign check",
    why: "Only holds with something left to issue are shown.",
  },
  "apps/web/src/features/hr/commissions/plan-form-dialog.tsx: Number(numeric(e.target.value))": {
    use: "whole number",
    why: "The clawback window in days.",
  },
  "apps/web/src/features/hr/pay-periods-page.tsx: Number(r.line.discretionaryBonus)": {
    use: "arithmetic shown",
    why: "The pay review's Bonus column (and its total) adds the two bonuses as floats.",
  },
  "apps/web/src/features/hr/pay-periods-page.tsx: Number(r.line.nondiscretionaryBonus)": {
    use: "arithmetic shown",
    why: "The pay review's Bonus column (and its total) adds the two bonuses as floats.",
  },
  "apps/web/src/features/inventory/adjust-stock-dialog.tsx: Number(quantity)": {
    use: "sign check",
    why: "Refuses a zero adjustment after a decimal pattern check (inventory.adjustments is removed).",
  },
  "apps/web/src/features/inventory/product-drawer.tsx: Number(c.lengthFt)": {
    use: "chart or gauge",
    why: "The roll gauge's cut marks.",
  },
  "apps/web/src/features/inventory/product-drawer.tsx: Number(roll.originalLengthFt)": {
    use: "chart or gauge",
    why: "The roll gauge's scale.",
  },
  "apps/web/src/features/inventory/product-drawer.tsx: Number(roll.remainingLengthFt)": {
    use: "chart or gauge",
    why: "The roll gauge's fill.",
  },
  "apps/web/src/features/inventory/products-table.tsx: Number(level(p)[key])": {
    use: "sort key",
    why: "On hand, reserved and available as sort and filter values; the cells show the strings.",
  },
  "apps/web/src/features/inventory/ready-to-cut.tsx: Number(h.quantity)": {
    use: "sign check",
    why: "Keeps holds with something left to cut, and sorts by it.",
  },
  "apps/web/src/features/inventory/roll/roll-page.tsx: Number(c.lengthFt)": {
    use: "chart or gauge",
    why: "The roll gauge's cut marks.",
  },
  "apps/web/src/features/inventory/roll/roll-page.tsx: Number(roll.originalLengthFt)": {
    use: "chart or gauge",
    why: "The roll gauge's scale.",
  },
  "apps/web/src/features/inventory/roll/roll-page.tsx: Number(roll.remainingLengthFt)": {
    use: "chart or gauge",
    why: "The roll gauge's fill.",
  },
  "apps/web/src/features/inventory/rolls-table.tsx: Number(c.lengthFt)": {
    use: "chart or gauge",
    why: "The roll gauge's cut marks.",
  },
  "apps/web/src/features/inventory/rolls-table.tsx: Number(r.originalLengthFt)": {
    use: "chart or gauge",
    why: "The roll gauge's scale.",
  },
  "apps/web/src/features/inventory/rolls-table.tsx: Number(r.remainingLengthFt)": {
    use: "chart or gauge",
    why: "The roll gauge's fill.",
  },
  "apps/web/src/features/inventory/rolls-table.tsx: Number(roll.remainingLengthFt)": {
    use: "comparison",
    why: "Labels a roll Used up (0) or Low (under LOW_ROLL_FT).",
  },
  "apps/web/src/features/invoices/commission-split-dialog.tsx: Number(pct)": {
    use: "arithmetic sent",
    why: 'The second share is sent as String(100 − Number(pct)): a first share of 66.6 sends 33.400000000000006, which the API refuses (400 "Enter each share as a percent.").',
  },
  "apps/web/src/features/my/my-commission.tsx: Number(s.payable)": {
    use: "arithmetic shown",
    why: "Waiting to be paid adds the statements' payable amounts as floats.",
  },
  "apps/web/src/features/my/my-pay.tsx: Number(bonus)": {
    use: "sign check",
    why: "Shows the Bonus row when the float-made sum is above zero.",
  },
  "apps/web/src/features/my/my-pay.tsx: Number(line.discretionaryBonus)": {
    use: "arithmetic shown",
    why: "The pay card's Bonus adds the two bonuses as floats.",
  },
  "apps/web/src/features/my/my-pay.tsx: Number(line.nondiscretionaryBonus)": {
    use: "arithmetic shown",
    why: "The pay card's Bonus adds the two bonuses as floats.",
  },
  "apps/web/src/features/my/my-pay.tsx: Number(line.salaryAmount)": {
    use: "sign check",
    why: "Whether the pay line is salaried.",
  },
  "apps/web/src/features/my/my-pay.tsx: Number(line.salaryDeduction)": {
    use: "sign check",
    why: "Shows the unpaid-leave row only when there is one.",
  },
  "apps/web/src/features/my/my-time-off.tsx: Number(b.pending)": {
    use: "sign check",
    why: "Shows pending hours only when there are some.",
  },
  "apps/web/src/features/purchasing/po-pdf.tsx: Number(l.quantity)": {
    use: "arithmetic shown",
    why: "The printed purchase order's line amount is quantity × unit cost as floats.",
  },
  "apps/web/src/features/purchasing/po-pdf.tsx: Number(l.unitCost)": {
    use: "arithmetic shown",
    why: "The printed purchase order's line amount is quantity × unit cost as floats.",
  },
  "apps/web/src/features/quotes/rooms-list.tsx: Number(value)": {
    use: "number in the contract",
    why: "A quote room's width and length are numbers in the shared Room type (F-k).",
  },
  "apps/web/src/features/reports/business-report.tsx: Number(r.values[column] ?? 0)": {
    use: "chart or gauge",
    why: "Bar widths in the Business report; each value is shown from its string.",
  },
  "apps/web/src/features/reports/business-report.tsx: Number(row.values[column] ?? 0)": {
    use: "sign check",
    why: "Draws a bar only for a value above zero.",
  },
  "apps/web/src/features/sales/team-table.tsx: Number(r.paidRevenue)": {
    use: "sign check",
    why: "Keeps team rows with sales or paid revenue.",
  },
  "apps/web/src/features/sales/team-table.tsx: Number(r.sales)": {
    use: "sign check",
    why: "Keeps team rows with sales or paid revenue.",
  },
  "apps/web/src/features/settings/documents/documents-page.tsx: Number(e.target.value)": {
    use: "whole number",
    why: "Quote expiry and balance-due days, clamped and rounded.",
  },
  "apps/web/src/features/settings/hr/policy-dialog.tsx: Number(numeric(e.target.value))": {
    use: "whole number",
    why: "A time-off policy's waiting period in days.",
  },
};
