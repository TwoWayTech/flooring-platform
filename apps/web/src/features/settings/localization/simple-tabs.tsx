"use client";

import {
  CALIFORNIA_PENDING_NOTE,
  californiaPayOn,
  companyOvertimeRule,
  FX_RATE_TEXT_MAX,
  localizationTabProblem,
  OVERTIME_RULE_LABELS,
  statesOfOperationChanged,
  US_STATES,
  type HoldsKey,
  type LocalizationSettings,
  type OvertimeRule,
} from "@workspace/shared";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { CaliforniaPayNote } from "@/features/hr/california-pay-note";
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
const TIME_ZONES: Readonly<Record<string, string>> = {
  "America/New_York": "Eastern",
  "America/Chicago": "Central",
  "America/Denver": "Mountain",
  "America/Phoenix": "Arizona",
  "America/Los_Angeles": "Pacific",
};

/** A time zone as the Region tab shows it: "Mountain (America/Denver)", or any other IANA zone as it is. */
function zoneLabel(zone: string): string {
  const name = TIME_ZONES[zone];
  return name ? `${name} (${zone})` : zone;
}

/**
 * Region: country, states, time zone, date format, week and fiscal year, area unit. The time zone is
 * the company's own, set when the company is set up, so it is shown read only (ADR 0059, part 2b).
 */
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
      <SettingRow setting="region.timeZone">
        {(id) => <Input id={id} value={zoneLabel(draft.timeZone)} disabled aria-describedby={`${id}-hint`} />}
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
                  maxLength={FX_RATE_TEXT_MAX}
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

/**
 * What the Region and Currency forms add to their tab (ADR 0059, part 2b): Save first runs the
 * shared rule and the extra key against the company's current tab (`localizationTabProblem`, the
 * one DemoStore runs and the API answers), so a refused value never costs a code; Region asks for a
 * code only when the states of operation change, Currency always (the page's TABS). Reset keeps
 * what Settings can't change (the zone, country and locale; the base, its lock and the currencies),
 * so a reset draft is never refused for them. `current` is the company's localization as the shell
 * reads it, `original` the demo's originals, `holds` whether the person holds a key.
 */
export function regionCurrencyForms(current: L, original: L, holds: HoldsKey) {
  return {
    region: {
      problem: (draft: L["region"]) => localizationTabProblem("region", draft, current.region, holds),
      stepUp: (draft: L["region"]) => statesOfOperationChanged(draft, current.region),
      defaults: {
        ...original.region,
        timeZone: current.region.timeZone,
        country: current.region.country,
        locale: current.region.locale,
      },
    },
    currency: {
      problem: (draft: L["currency"]) => localizationTabProblem("currency", draft, current.currency, holds),
      defaults: {
        ...original.currency,
        base: current.currency.base,
        locked: current.currency.locked,
        extra: current.currency.extra.map(
          (entry) => original.currency.extra.find((stored) => stored.code === entry.code) ?? entry,
        ),
      },
    },
  };
}

/** Payroll rules that follow the location: the overtime rule and the holiday calendar. Pay calendar is in Settings → HR. */
export function PayrollTab({ draft, setDraft, changed }: SectionProps<L["payroll"]>) {
  // The California rule is offered only while its switch is on (ADR 0050).
  const options: Partial<Record<OvertimeRule, string>> = californiaPayOn()
    ? OVERTIME_RULE_LABELS
    : { federal: OVERTIME_RULE_LABELS.federal };
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {californiaPayOn() ? <CaliforniaPayNote note={CALIFORNIA_PENDING_NOTE} className="sm:col-span-2" /> : null}
      <SettingRow setting="payroll.overtimeRule" changed={changed("overtimeRule")}>
        {(id) => (
          <Choice
            id={id}
            value={companyOvertimeRule(draft.overtimeRule)}
            options={options as Record<OvertimeRule, string>}
            onChange={(overtimeRule: OvertimeRule) => setDraft({ ...draft, overtimeRule })}
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
