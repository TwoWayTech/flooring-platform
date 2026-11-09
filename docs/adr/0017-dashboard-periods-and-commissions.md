# ADR 0017: One dashboard period, and commissions earned on confirmed payments

Date: 2026-11-09. Status: accepted.

## Context
Feature batch 2, Batch E: the dashboard needs one period selector and a warehouse filter over a row of key figure cards with the change vs the previous period and a sparkline (E1), and the sales team needs commission rules, a Team view and a top performer (E2). The old `commissions` collection stored a monthly amount per employee computed from invoiced sales, and nothing in the UI read it.

## Decision
- `packages/shared/src/dashboard.ts`: `periodRange` (this month, last 30 days, this quarter, year to date, custom) with the previous period of the same length, `salesTotals`, `changePct`, `sparkSeries` (up to 12 buckets) and `bestSellersIn` (any range, by revenue, quantity or margin, one category, one warehouse). The page loads the records once and recomputes when the period or warehouse changes.
- Cards sit in an auto-fit grid with a minimum width, so they never wrap awkwardly; each shows the value in compact tabular numerals, the change with an arrow and words (never colour alone) and a one-series sparkline in the first chart colour. The 12-month revenue and margin panel keeps its chart / table toggle; Best sellers gets its own period, metric, category and chart / table toggle.
- Commission rules live in `CompanySettings.commissions.rules` (Settings → Commissions, `sales.commission.manage`): per role or per person (a person's rule wins), on paid revenue or gross margin, with optional tiers (the highest tier the period reaches sets the rate). `teamStats` computes sales, paid revenue (the revenue share of payments confirmed in the period), margin, quotes sent, conversion, average deal and commission. Commission is paid with payroll at month end, so earned before this month counts as paid and this month's is pending; no payouts are stored.
- Sales → Team shows the figures for a period and warehouse; data scope applies (Sales see their own row), margin needs view_sensitive, and its CSV is the payroll export of commission totals. The dashboard's Top performer reads Employee of the year when the period covers most of a year.
- `sales.commission.view` follows data scope (plan K-3); the old `commissions` collection stays for HR fixtures but is not used for these figures.

## Consequences
- The HR app has no separate payroll export yet; commission totals export from Sales → Team.
