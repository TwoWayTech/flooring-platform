# ADR 0010: Default tax rates and per-document overrides

Date: 2026-11-08. Status: accepted.

## Context
Feature batch 2, item A5: a company default rate plus default rates per state and jurisdiction with effective dates, on top of the existing rules engine. New quotes and invoices fill tax from the job site (jurisdiction rule, then state default, then company default) and say where the rate came from. Changing tax on one document needs `sales.tax.override`, a reason and an audit entry. Until now one rule per state applied regardless of date or county, and a state without a rule collected nothing.

## Decision
- The existing state rules are the state defaults and gain an optional `validTo`. Two layers are added to `LocalizationSettings.tax`: `jurisdictions` (state, county, name, rate, valid from and to) and `companyDefault` (rate, taxability, valid from).
- `resolveTaxRule` (`packages/shared/src/us-pack/tax-defaults.ts`) picks, for a job site and a date: the county rate (keeping the state rule's taxability), else the state default, else the company default, which applies only in the company's states of operation (plan K-5), else "Not collected". It returns the rule and a `TaxSource` label such as "Default rate for Colorado (example)".
- `taxContextFor` takes the localization settings, the job-site address and an optional `TaxOverride`; quotes store `taxOverride`, invoices store `taxSource` and `taxOverride`. The quote summary shows the source under the tax line; the invoice screen shows it too, but not the printed copy.
- The store refuses a changed `taxOverride` without `sales.tax.override` and writes a "Changed tax on a document" audit entry with the old and new rate and the reason.
- Addresses carry a county. Examples: Colorado Springs (El Paso County) 8.25 %, Philadelphia 8 %, Allegheny County 7 %, and a 4 % company default; Summit now also operates in Wyoming, where the company default applies. Every example keeps the label "Example: confirm with your accountant". The example state rules now start on 2025-01-01 so the whole 12-month history falls inside them.

## Consequences
- The seeded counties were chosen so no generated invoice changes total; the reconciliation test now recomputes each invoice with the rule its job site and date resolve to.
- The quote tests call `taxContextFor` with the new arguments; their expectations did not change.
