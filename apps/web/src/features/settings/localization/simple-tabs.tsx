"use client";

import { OVERTIME_RULE_LABELS, US_STATES, type LocalizationSettings, type OvertimeRule } from "@workspace/shared";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Choice } from "../form/choice";
import { SettingRow } from "../form/setting-row";

type L = LocalizationSettings;

/** What every section body receives from its SettingsForm. */
export interface SectionProps<T> {
  draft: T;
  setDraft: (next: T) => void;
  changed: (key: keyof T) => boolean;
}

export const STATE_OPTIONS = Object.fromEntries(US_STATES.map(([c, n]) => [c, n])) as Record<string, string>;
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
export function RegionTab({ draft, setDraft, changed }: SectionProps<L["region"]>) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SettingRow setting="region.country">
        {(id) => <Input id={id} value="United States" disabled aria-describedby={`${id}-hint`} />}
      </SettingRow>
      <SettingRow setting="region.primaryState" changed={changed("primaryState")}>
        {(id) => (
          <Choice
            id={id}
            value={draft.primaryState}
            options={STATE_OPTIONS}
            onChange={(primaryState) => setDraft({ ...draft, primaryState })}
          />
        )}
      </SettingRow>
      <SettingRow setting="region.timeZone" changed={changed("timeZone")}>
        {(id) => (
          <Choice
            id={id}
            value={draft.timeZone as keyof typeof TIME_ZONES}
            options={TIME_ZONES}
            onChange={(timeZone) => setDraft({ ...draft, timeZone })}
          />
        )}
      </SettingRow>
      <SettingRow setting="region.dateFormat" changed={changed("dateFormat")}>
        {(id) => (
          <Choice
            id={id}
            value={draft.dateFormat}
            options={{ "MMM d, yyyy": "Nov 7, 2026", "MM/dd/yyyy": "11/07/2026", "yyyy-MM-dd": "2026-11-07" }}
            onChange={(dateFormat) => setDraft({ ...draft, dateFormat })}
          />
        )}
      </SettingRow>
      <SettingRow setting="region.firstDayOfWeek" changed={changed("firstDayOfWeek")}>
        {(id) => (
          <Choice
            id={id}
            value={draft.firstDayOfWeek}
            options={{ monday: "Monday", sunday: "Sunday" }}
            onChange={(firstDayOfWeek) => setDraft({ ...draft, firstDayOfWeek })}
          />
        )}
      </SettingRow>
      <SettingRow setting="region.fiscalYearStartMonth" changed={changed("fiscalYearStartMonth")}>
        {(id) => (
          <Choice
            id={id}
            value={String(draft.fiscalYearStartMonth)}
            options={MONTHS}
            onChange={(m) => setDraft({ ...draft, fiscalYearStartMonth: Number(m) })}
          />
        )}
      </SettingRow>
      <SettingRow setting="region.statesOfOperation" changed={changed("statesOfOperation")} className="sm:col-span-2">
        {(id) => (
          <div
            id={id}
            role="group"
            aria-labelledby={`${id}-label`}
            className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6"
          >
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
        )}
      </SettingRow>
    </div>
  );
}

/** Currency: the locked base currency and extra currencies with their rates. */
export function CurrencyTab({ draft, setDraft, changed }: SectionProps<L["currency"]>) {
  return (
    <div className="flex flex-col gap-4">
      <SettingRow setting="currency.base">
        {(id) => <Input id={id} value="USD, US dollar" disabled className="sm:w-72" aria-describedby={`${id}-hint`} />}
      </SettingRow>
      <SettingRow setting="currency.extra" changed={changed("extra")}>
        {(id) => (
          <div id={id} className="flex flex-col gap-2">
            {draft.extra.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No other currencies. Bills from abroad are entered in USD.
              </p>
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
        )}
      </SettingRow>
    </div>
  );
}

/** Payroll rules: the overtime rule that flags timesheets, pay frequency, PTO accrual and holidays. */
export function PayrollTab({ draft, setDraft, changed }: SectionProps<L["payroll"]>) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SettingRow setting="payroll.overtimeRule" changed={changed("overtimeRule")}>
        {(id) => (
          <Choice
            id={id}
            value={draft.overtimeRule}
            options={OVERTIME_RULE_LABELS}
            onChange={(overtimeRule: OvertimeRule) => setDraft({ ...draft, overtimeRule })}
          />
        )}
      </SettingRow>
      <SettingRow setting="payroll.payFrequency" changed={changed("payFrequency")}>
        {(id) => (
          <Choice
            id={id}
            value={draft.payFrequency}
            options={{ weekly: "Weekly", biweekly: "Every two weeks", semimonthly: "Twice a month" }}
            onChange={(payFrequency) => setDraft({ ...draft, payFrequency })}
          />
        )}
      </SettingRow>
      <SettingRow setting="payroll.ptoAccrualHoursPerMonth" changed={changed("ptoAccrualHoursPerMonth")}>
        {(id) => (
          <Input
            id={id}
            inputMode="decimal"
            aria-describedby={`${id}-hint`}
            value={draft.ptoAccrualHoursPerMonth}
            onChange={(e) => setDraft({ ...draft, ptoAccrualHoursPerMonth: e.target.value.replace(/[^\d.]/g, "") })}
            className="w-28 tabular-nums"
          />
        )}
      </SettingRow>
      <SettingRow setting="payroll.holidayState" changed={changed("holidayState")}>
        {(id) => (
          <Choice
            id={id}
            value={draft.holidayState}
            options={STATE_OPTIONS}
            onChange={(holidayState) => setDraft({ ...draft, holidayState })}
          />
        )}
      </SettingRow>
    </div>
  );
}
