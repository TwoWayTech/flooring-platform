"use client";

import { Plus, Trash2 } from "lucide-react";
import {
  stateName,
  TAX_CATEGORY_LABELS,
  TAX_COUNTY_MAX,
  TAX_NAME_MAX,
  TAX_RATE_TEXT_MAX,
  US_STATES,
  type JurisdictionRate,
  type LocalizationSettings,
  type StateCode,
  type TaxCategory,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { Switch } from "@workspace/ui/components/switch";
import { ScrollRegion } from "@/components/scroll-region";
import { api } from "@/lib/api";
import { SettingRow } from "../form/setting-row";
import type { SectionProps } from "./simple-tabs";

type Tax = LocalizationSettings["tax"];
const CATEGORIES: TaxCategory[] = ["material", "labor", "freight", "service"];
const rate = (value: string) => value.replace(/[^\d.]/g, "") || "0";

/** The company default rate (spec A5): on or off, its rate, what it taxes and from when; dates are the save's (part 3a). */
export function CompanyDefaultRow({ draft, setDraft, changed }: SectionProps<Tax>) {
  const current = draft.companyDefault;
  return (
    <SettingRow setting="tax.companyDefault" changed={changed("companyDefault")}>
      {(id) => (
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-3 text-sm">
            <Switch
              id={id}
              aria-describedby={`${id}-hint`}
              checked={!!current}
              onCheckedChange={(on) =>
                setDraft({
                  ...draft,
                  companyDefault: on
                    ? {
                        ratePct: "0",
                        taxable: { material: true, labor: false, freight: false, service: false },
                        validFrom: api.today(),
                      }
                    : null,
                })
              }
            />
            Use a company default rate
          </label>
          {current ? (
            <div className="flex flex-wrap items-center gap-4">
              <span className="flex items-center gap-1">
                <Input
                  aria-label="Company default rate in percent"
                  inputMode="decimal"
                  maxLength={TAX_RATE_TEXT_MAX}
                  value={current.ratePct}
                  onChange={(e) =>
                    setDraft({ ...draft, companyDefault: { ...current, ratePct: rate(e.target.value) } })
                  }
                  className="h-8 w-20 text-right tabular-nums"
                />
                <span className="text-muted-foreground text-xs">%</span>
              </span>
              <Input
                type="date"
                aria-label="Company default rate valid from"
                value={current.validFrom}
                disabled
                className="h-8 w-40"
              />
              {CATEGORIES.map((c) => (
                <label key={c} className="flex items-center gap-2 text-xs">
                  <Switch
                    checked={current.taxable[c]}
                    onCheckedChange={(on) =>
                      setDraft({
                        ...draft,
                        companyDefault: { ...current, taxable: { ...current.taxable, [c]: on } },
                      })
                    }
                  />
                  {TAX_CATEGORY_LABELS[c]}
                </label>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </SettingRow>
  );
}

/** A new county rate in the first state the company has a rule for. */
function newJurisdiction(state: StateCode): JurisdictionRate {
  return {
    id: `jur-${crypto.randomUUID().slice(0, 8)}`,
    state,
    county: "",
    name: "",
    ratePct: "0",
    validFrom: api.today(),
    validTo: null,
  };
}

/** County rates that replace a state default, each with its own effective dates (spec A5); dates are the save's (part 3a). */
export function JurisdictionsTable({ draft, setDraft, changed }: SectionProps<Tax>) {
  const setRow = (i: number, row: JurisdictionRate) =>
    setDraft({ ...draft, jurisdictions: draft.jurisdictions.map((j, k) => (k === i ? row : j)) });
  return (
    <SettingRow setting="tax.jurisdictions" changed={changed("jurisdictions")}>
      {(id) => (
        <div id={id} className="flex flex-col gap-2">
          <ScrollRegion label="County rates" className="border-hairline rounded-md border">
            <table className="w-full min-w-[52rem] text-sm">
              <thead className="bg-raised text-muted-foreground text-xs">
                <tr>
                  {["State", "County", "Name", "Rate", "Valid from", "Valid to"].map((h) => (
                    <th key={h} scope="col" className="h-9 px-3 text-left font-medium">
                      {h}
                    </th>
                  ))}
                  <th scope="col" className="w-10">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {draft.jurisdictions.map((row, i) => {
                  const label = row.name || `county rate ${i + 1}`;
                  return (
                    <tr key={row.id} className="border-hairline border-t">
                      <td className="px-3 py-2">
                        <Select
                          value={row.state}
                          onValueChange={(state) => setRow(i, { ...row, state: state as StateCode })}
                        >
                          <SelectTrigger className="h-8 w-40" aria-label={`${label} state`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="max-h-80">
                            {US_STATES.map(([code, name]) => (
                              <SelectItem key={code} value={code}>
                                {name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          aria-label={`${label} county`}
                          maxLength={TAX_COUNTY_MAX}
                          value={row.county}
                          onChange={(e) => setRow(i, { ...row, county: e.target.value })}
                          className="h-8 w-32"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          aria-label={`${label} name`}
                          maxLength={TAX_NAME_MAX}
                          value={row.name}
                          onChange={(e) => setRow(i, { ...row, name: e.target.value })}
                          className="h-8"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-1">
                          <Input
                            aria-label={`${label} rate in percent`}
                            inputMode="decimal"
                            maxLength={TAX_RATE_TEXT_MAX}
                            value={row.ratePct}
                            onChange={(e) => setRow(i, { ...row, ratePct: rate(e.target.value) })}
                            className="h-8 w-20 text-right tabular-nums"
                          />
                          <span className="text-muted-foreground text-xs">%</span>
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="date"
                          aria-label={`${label} valid from`}
                          value={row.validFrom}
                          disabled
                          className="h-8 w-40"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="date"
                          aria-label={`${label} valid to`}
                          value={row.validTo ?? ""}
                          disabled
                          className="h-8 w-40"
                        />
                      </td>
                      <td className="pr-2 text-right">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove ${label}`}
                          onClick={() =>
                            setDraft({ ...draft, jurisdictions: draft.jurisdictions.filter((_, k) => k !== i) })
                          }
                        >
                          <Trash2 />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollRegion>
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() =>
              setDraft({
                ...draft,
                jurisdictions: [...draft.jurisdictions, newJurisdiction((draft.rules[0]?.state ?? "CO") as StateCode)],
              })
            }
          >
            <Plus />
            Add a county rate
          </Button>
          <p className="text-muted-foreground text-xs">
            Each county rate keeps its state&apos;s taxability. States:{" "}
            {draft.rules.map((r) => stateName(r.state)).join(", ")}.
          </p>
        </div>
      )}
    </SettingRow>
  );
}
