"use client";

import { Plus, Trash2 } from "lucide-react";
import {
  EXAMPLE_RULE_NOTE,
  localizationTabProblem,
  stateName,
  TAX_CATEGORY_LABELS,
  TAX_NAME_MAX,
  TAX_RATE_TEXT_MAX,
  US_STATES,
  type HoldsKey,
  type LocalizationSettings,
  type StateCode,
  type TaxCategory,
  type TaxRule,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { Switch } from "@workspace/ui/components/switch";
import { Choice } from "../form/choice";
import { ScrollRegion } from "@/components/scroll-region";
import { SettingRow } from "../form/setting-row";
import type { SectionProps } from "./simple-tabs";
import { CompanyDefaultRow, JurisdictionsTable } from "./tax-defaults-section";

type Tax = LocalizationSettings["tax"];
const CATEGORIES: TaxCategory[] = ["material", "labor", "freight", "service"];
/** How documents apply tax, in the words the tab shows it (read only, ADR 0059, part 3a, D9). */
const PRICES: Record<Tax["pricesInclude"], string> = {
  exclusive: "Before tax (tax added on top)",
  inclusive: "Tax included",
};

/**
 * What the Sales tax form adds to its tab (ADR 0059, part 3a): Save first runs the shared rule
 * against the company's tab (`localizationTabProblem`, the one DemoStore runs and the API answers),
 * so a refused value never costs a code; Reset keeps what this tab can't change (filing frequencies,
 * certificate types) from the company's own copy; `revision` changes whenever the tab in force
 * changes, so the page remounts the form after a save and it shows the save's dates, versions and
 * ids (D27).
 */
export function taxForm(current: Tax, original: Tax, holds: HoldsKey) {
  return {
    revision: JSON.stringify(current),
    problem: (draft: Tax) => localizationTabProblem("tax", draft, current, holds),
    defaults: { ...original, filing: current.filing, certificateTypes: current.certificateTypes },
  };
}

/** A new rule for a state: materials taxed at 0 % until the accountant confirms the rate; the save dates it. */
function newRule(state: StateCode): TaxRule {
  return {
    state,
    jurisdiction: `${stateName(state)} statewide`,
    ratePct: "0",
    taxable: { material: true, labor: false, freight: false, service: false },
    lumpSumLaborTaxable: false,
    validFrom: new Date().toISOString().slice(0, 10),
    version: 1,
    rationale: "Added in settings.",
  };
}

/**
 * The Sales tax tab (blueprint "Localization, currency and tax settings", spec A5): state default
 * rules with a combined rate, what is taxable and from when, county rates on top, and a company
 * default. Documents resolve job site → county → state → company default. Dates are set by the
 * save and shown read only; whether prices include tax is shown, not edited (ADR 0059, part 3a).
 */
export function TaxTab({ draft, setDraft, changed }: SectionProps<Tax>) {
  const setRule = (i: number, rule: TaxRule) =>
    setDraft({ ...draft, rules: draft.rules.map((r, j) => (j === i ? { ...rule, version: rule.version } : r)) });
  const unused = US_STATES.filter(([code]) => !draft.rules.some((r) => r.state === code));

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <SettingRow setting="tax.pricesInclude" changed={changed("pricesInclude")}>
          {(id) => <Input id={id} value={PRICES[draft.pricesInclude]} disabled aria-describedby={`${id}-hint`} />}
        </SettingRow>
        <SettingRow setting="tax.rounding" changed={changed("rounding")}>
          {(id) => (
            <Choice
              id={id}
              value={draft.rounding}
              options={{ invoice: "Once per invoice", line: "On each line" }}
              onChange={(rounding) => setDraft({ ...draft, rounding })}
            />
          )}
        </SettingRow>
      </div>
      <p className="bg-warning/14 text-warning-ink rounded-md px-3 py-2 text-sm">
        {EXAMPLE_RULE_NOTE}. Rates and taxability are examples.
      </p>
      <p className="text-muted-foreground text-xs">
        A change takes effect today: the old rule ends yesterday and the new one starts today, so issued invoices keep
        the tax they were issued with.
      </p>
      <CompanyDefaultRow draft={draft} setDraft={setDraft} changed={changed} />
      <ScrollRegion label="Tax rules by state" className="border-hairline rounded-md border">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="bg-raised text-muted-foreground text-xs">
            <tr>
              <th scope="col" className="h-9 px-3 text-left font-medium">
                State
              </th>
              <th scope="col" className="px-3 text-left font-medium">
                Jurisdiction
              </th>
              <th scope="col" className="px-3 text-right font-medium">
                Rate
              </th>
              <th scope="col" className="px-3 text-left font-medium">
                Valid from
              </th>
              {CATEGORIES.map((c) => (
                <th key={c} scope="col" className="px-2 text-center font-medium">
                  {TAX_CATEGORY_LABELS[c]}
                </th>
              ))}
              <th scope="col" className="w-10">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {draft.rules.map((rule, i) => (
              <tr key={rule.state} className="border-hairline border-t">
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  {stateName(rule.state)}
                </th>
                <td className="px-3 py-2">
                  <Input
                    aria-label={`${stateName(rule.state)} jurisdiction`}
                    maxLength={TAX_NAME_MAX}
                    value={rule.jurisdiction}
                    onChange={(e) => setRule(i, { ...rule, jurisdiction: e.target.value })}
                    className="h-8"
                  />
                </td>
                <td className="px-3 py-2">
                  <span className="flex items-center justify-end gap-1">
                    <Input
                      aria-label={`${stateName(rule.state)} rate in percent`}
                      inputMode="decimal"
                      maxLength={TAX_RATE_TEXT_MAX}
                      value={rule.ratePct}
                      onChange={(e) => setRule(i, { ...rule, ratePct: e.target.value.replace(/[^\d.]/g, "") || "0" })}
                      className="h-8 w-20 text-right tabular-nums"
                    />
                    <span className="text-muted-foreground text-xs">%</span>
                  </span>
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="date"
                    aria-label={`${stateName(rule.state)} valid from`}
                    value={rule.validFrom}
                    disabled
                    className="h-8 w-40"
                  />
                </td>
                {CATEGORIES.map((c) => (
                  <td key={c} className="px-2 text-center">
                    <Switch
                      aria-label={`${TAX_CATEGORY_LABELS[c]} taxable in ${stateName(rule.state)}`}
                      checked={rule.taxable[c]}
                      onCheckedChange={(on) => setRule(i, { ...rule, taxable: { ...rule.taxable, [c]: on } })}
                    />
                  </td>
                ))}
                <td className="pr-2 text-right">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${stateName(rule.state)}`}
                    onClick={() => setDraft({ ...draft, rules: draft.rules.filter((_, j) => j !== i) })}
                  >
                    <Trash2 />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      <Select
        value=""
        onValueChange={(code) => setDraft({ ...draft, rules: [...draft.rules, newRule(code as StateCode)] })}
      >
        <SelectTrigger className="w-60" aria-label="Add a state">
          <Plus aria-hidden="true" className="size-4" />
          <SelectValue placeholder="Add a state" />
        </SelectTrigger>
        <SelectContent className="max-h-80">
          {unused.map(([code, name]) => (
            <SelectItem key={code} value={code}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <JurisdictionsTable draft={draft} setDraft={setDraft} changed={changed} />
    </>
  );
}
