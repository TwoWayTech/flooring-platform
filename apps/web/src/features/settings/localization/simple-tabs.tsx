"use client";

import {
  OVERTIME_RULE_LABELS,
  PAYMENT_TERM_LABELS,
  US_STATES,
  type LocalizationSettings,
  type OvertimeRule,
  type PaymentTerms,
} from "@workspace/shared";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { Textarea } from "@workspace/ui/components/textarea";
import { Field } from "@/components/field";

type L = LocalizationSettings;

/** A select over a fixed set of labelled options. */
function Choice<T extends string>({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: T;
  options: Record<T, string>;
  onChange: (v: T) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {(Object.keys(options) as T[]).map((k) => (
          <SelectItem key={k} value={k}>
            {options[k]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const STATE_OPTIONS = Object.fromEntries(US_STATES.map(([c, n]) => [c, n])) as Record<string, string>;
const MONTHS = Object.fromEntries(
  [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ].map((m, i) => [String(i + 1), m]),
) as Record<string, string>;
const TIME_ZONES = {
  "America/New_York": "Eastern",
  "America/Chicago": "Central",
  "America/Denver": "Mountain",
  "America/Phoenix": "Arizona",
  "America/Los_Angeles": "Pacific",
};

/** Region: country, states, time zone, date format, week and fiscal year, area unit. */
export function RegionTab({ draft, setDraft }: { draft: L["region"]; setDraft: (v: L["region"]) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id="region-country" label="Country" hint="The US pack: 50 states and DC, imperial units, USD.">
        <Input id="region-country" value="United States" disabled />
      </Field>
      <Field id="region-primary" label="Primary state">
        <Choice
          id="region-primary"
          value={draft.primaryState}
          options={STATE_OPTIONS}
          onChange={(primaryState) => setDraft({ ...draft, primaryState })}
        />
      </Field>
      <Field id="region-tz" label="Time zone">
        <Choice
          id="region-tz"
          value={draft.timeZone as keyof typeof TIME_ZONES}
          options={TIME_ZONES}
          onChange={(timeZone) => setDraft({ ...draft, timeZone })}
        />
      </Field>
      <Field id="region-date" label="Date format">
        <Choice
          id="region-date"
          value={draft.dateFormat}
          options={{ "MMM d, yyyy": "Nov 7, 2026", "MM/dd/yyyy": "11/07/2026", "yyyy-MM-dd": "2026-11-07" }}
          onChange={(dateFormat) => setDraft({ ...draft, dateFormat })}
        />
      </Field>
      <Field id="region-week" label="Week starts on">
        <Choice
          id="region-week"
          value={draft.firstDayOfWeek}
          options={{ monday: "Monday", sunday: "Sunday" }}
          onChange={(firstDayOfWeek) => setDraft({ ...draft, firstDayOfWeek })}
        />
      </Field>
      <Field id="region-fiscal" label="Fiscal year starts">
        <Choice
          id="region-fiscal"
          value={String(draft.fiscalYearStartMonth)}
          options={MONTHS}
          onChange={(m) => setDraft({ ...draft, fiscalYearStartMonth: Number(m) })}
        />
      </Field>
      <Field
        id="region-area"
        label="Default area unit"
        hint="Area is always stored in sq ft; this changes what lists show first."
      >
        <Choice
          id="region-area"
          value={draft.areaUnit}
          options={{ sq_ft: "Square feet", sq_yd: "Square yards" }}
          onChange={(areaUnit) => setDraft({ ...draft, areaUnit })}
        />
      </Field>
      <fieldset className="flex flex-col gap-2 sm:col-span-2">
        <legend className="mb-1 text-sm font-medium">States of operation</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {US_STATES.map(([code, name]) => (
            <label key={code} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={draft.statesOfOperation.includes(code)}
                onCheckedChange={(on) =>
                  setDraft({
                    ...draft,
                    statesOfOperation: on
                      ? [...draft.statesOfOperation, code]
                      : draft.statesOfOperation.filter((s) => s !== code),
                  })
                }
              />
              {name}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

/** Currency: the locked base currency and extra currencies with their rates. */
export function CurrencyTab({ draft, setDraft }: { draft: L["currency"]; setDraft: (v: L["currency"]) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <Field
        id="currency-base"
        label="Base currency"
        hint={draft.locked ? "Locked after the first posted document." : undefined}
      >
        <Input id="currency-base" value="USD, US dollar" disabled className="sm:w-72" />
      </Field>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Other currencies</span>
        {draft.extra.length === 0 ? (
          <p className="text-muted-foreground text-sm">No other currencies. Bills from abroad are entered in USD.</p>
        ) : null}
        {draft.extra.map((x, i) => (
          <div key={x.code} className="flex items-center gap-3">
            <span className="w-12 font-medium">{x.code}</span>
            <Label htmlFor={`fx-${x.code}`} className="text-muted-foreground font-normal">
              per 1 USD
            </Label>
            <Input
              id={`fx-${x.code}`}
              inputMode="decimal"
              value={x.rate}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  extra: draft.extra.map((y, j) =>
                    j === i ? { ...y, rate: e.target.value.replace(/[^\d.]/g, "") } : y,
                  ),
                })
              }
              className="w-28 text-right tabular-nums"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Payroll rules: the overtime rule that flags timesheets, pay frequency, PTO accrual and holidays. */
export function PayrollTab({ draft, setDraft }: { draft: L["payroll"]; setDraft: (v: L["payroll"]) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field
        id="payroll-ot"
        label="Overtime rule"
        hint="Workers in California follow the California rule whatever is chosen here."
      >
        <Choice
          id="payroll-ot"
          value={draft.overtimeRule}
          options={OVERTIME_RULE_LABELS}
          onChange={(overtimeRule: OvertimeRule) => setDraft({ ...draft, overtimeRule })}
        />
      </Field>
      <Field id="payroll-freq" label="Pay frequency">
        <Choice
          id="payroll-freq"
          value={draft.payFrequency}
          options={{ weekly: "Weekly", biweekly: "Every two weeks", semimonthly: "Twice a month" }}
          onChange={(payFrequency) => setDraft({ ...draft, payFrequency })}
        />
      </Field>
      <Field id="payroll-pto" label="PTO accrual, hours per month">
        <Input
          id="payroll-pto"
          inputMode="decimal"
          value={draft.ptoAccrualHoursPerMonth}
          onChange={(e) => setDraft({ ...draft, ptoAccrualHoursPerMonth: e.target.value.replace(/[^\d.]/g, "") })}
          className="w-28 tabular-nums"
        />
      </Field>
      <Field id="payroll-holidays" label="Holiday calendar">
        <Choice
          id="payroll-holidays"
          value={draft.holidayState}
          options={STATE_OPTIONS}
          onChange={(holidayState) => setDraft({ ...draft, holidayState })}
        />
      </Field>
    </div>
  );
}

/** Documents: default terms, late fee, numbering prefixes, deposit and the legal footer. */
export function DocumentsTab({ draft, setDraft }: { draft: L["documents"]; setDraft: (v: L["documents"]) => void }) {
  const text = (key: "quotePrefix" | "invoicePrefix" | "poPrefix", label: string) => (
    <Field id={`doc-${key}`} label={label}>
      <Input
        id={`doc-${key}`}
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        className="w-28"
      />
    </Field>
  );
  const pct = (key: "lateFeePct" | "defaultDepositPct", label: string) => (
    <Field id={`doc-${key}`} label={label}>
      <span className="flex items-center gap-1.5">
        <Input
          id={`doc-${key}`}
          inputMode="decimal"
          value={draft[key]}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value.replace(/[^\d.]/g, "") })}
          className="w-24 text-right tabular-nums"
        />
        <span className="text-muted-foreground text-sm">%</span>
      </span>
    </Field>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field id="doc-terms" label="Default payment terms" className="sm:col-span-1">
        <Choice
          id="doc-terms"
          value={draft.defaultTerms}
          options={PAYMENT_TERM_LABELS}
          onChange={(defaultTerms: PaymentTerms) => setDraft({ ...draft, defaultTerms })}
        />
      </Field>
      {pct("lateFeePct", "Late fee per month")}
      {pct("defaultDepositPct", "Default deposit on quotes")}
      {text("quotePrefix", "Quote number prefix")}
      {text("invoicePrefix", "Invoice number prefix")}
      {text("poPrefix", "Purchase order prefix")}
      <Field id="doc-footer" label="Legal footer" className="sm:col-span-3">
        <Textarea
          id="doc-footer"
          value={draft.legalFooter}
          onChange={(e) => setDraft({ ...draft, legalFooter: e.target.value })}
          rows={2}
        />
      </Field>
    </div>
  );
}
