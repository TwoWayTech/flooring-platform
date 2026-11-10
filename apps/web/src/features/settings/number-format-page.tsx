"use client";

import { Minus, Plus } from "lucide-react";
import { NUMBER_KINDS, type NumberKind, type NumberSettings } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Label } from "@workspace/ui/components/label";
import { Num } from "@workspace/ui/components/num";
import { NumberSettingsProvider } from "@workspace/ui/components/number-settings";
import { Panel } from "@workspace/ui/components/panel";
import { RadioGroup, RadioGroupItem } from "@workspace/ui/components/radio-group";
import { Switch } from "@workspace/ui/components/switch";
import { ScrollRegion } from "@/components/scroll-region";
import { NoAccess } from "@/components/no-access";
import { QueryFallback } from "@/components/query-fallback";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { SettingRow } from "./form/setting-row";
import { SettingsForm } from "./form/settings-form";
import type { SectionProps } from "./localization/simple-tabs";

const UNITS: Partial<Record<NumberKind, string>> = { quantity: "sq ft", count: "items" };

/** A − value + control for one number kind, kept inside the kind's allowed range. */
function DecimalsStepper({
  kind,
  value,
  onChange,
}: {
  kind: NumberKind;
  value: number;
  onChange: (v: number) => void;
}) {
  const { min, max, label } = NUMBER_KINDS[kind];
  return (
    <span className="inline-flex items-center gap-1" role="group" aria-label={`${label} decimals`}>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={`Fewer decimals for ${label}`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        <Minus />
      </Button>
      <span className="w-6 text-center font-medium tabular-nums" aria-live="polite">
        {value}
      </span>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={`More decimals for ${label}`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <Plus />
      </Button>
    </span>
  );
}

/** Decimals per kind, negative style and compact figures, previewed with the draft itself. */
function NumbersSection({ draft, setDraft, changed }: SectionProps<NumberSettings>) {
  return (
    <NumberSettingsProvider settings={draft}>
      <SettingRow setting="numbers.decimals" changed={changed("decimals")}>
        {(id) => (
          <ScrollRegion label="Number formats" className="border-hairline rounded-md border">
            <table id={id} className="w-full min-w-[32rem] text-sm">
              <thead className="bg-raised text-muted-foreground text-xs">
                <tr>
                  <th scope="col" className="h-9 px-3 text-left font-medium">
                    Kind of number
                  </th>
                  <th scope="col" className="px-3 text-left font-medium">
                    Decimals
                  </th>
                  <th scope="col" className="px-3 text-right font-medium">
                    Example
                  </th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(NUMBER_KINDS) as NumberKind[]).map((kind) => (
                  <tr key={kind} className="border-hairline border-t">
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      {NUMBER_KINDS[kind].label}
                      <span className="text-muted-foreground block text-xs">
                        Allowed {NUMBER_KINDS[kind].min} to {NUMBER_KINDS[kind].max}
                      </span>
                    </th>
                    <td className="px-3 py-2">
                      <DecimalsStepper
                        kind={kind}
                        value={draft.decimals[kind]}
                        onChange={(v) => setDraft({ ...draft, decimals: { ...draft.decimals, [kind]: v } })}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Num kind={kind} value={String(NUMBER_KINDS[kind].example)} unit={UNITS[kind]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </SettingRow>
      <div className="grid gap-6 sm:grid-cols-2">
        <SettingRow setting="numbers.negative" changed={changed("negativeStyle")}>
          {(id) => (
            <RadioGroup
              id={id}
              aria-labelledby={`${id}-label`}
              value={draft.negativeStyle}
              onValueChange={(v) => setDraft({ ...draft, negativeStyle: v as NumberSettings["negativeStyle"] })}
            >
              {(["minus", "parens"] as const).map((style) => (
                <div key={style} className="flex items-center gap-2">
                  <RadioGroupItem value={style} id={`neg-${style}`} />
                  <Label htmlFor={`neg-${style}`} className="font-normal">
                    <NumberSettingsProvider settings={{ ...draft, negativeStyle: style }}>
                      <Num kind="money" value="-1234" />
                    </NumberSettingsProvider>
                    <span className="text-muted-foreground">
                      {style === "minus" ? "with a minus sign" : "in parentheses"}
                    </span>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          )}
        </SettingRow>
        <SettingRow setting="numbers.compact" changed={changed("compactDashboards")}>
          {(id) => (
            <span className="flex items-center gap-3">
              <Switch
                id={id}
                aria-describedby={`${id}-hint`}
                checked={draft.compactDashboards}
                onCheckedChange={(compactDashboards) => setDraft({ ...draft, compactDashboards })}
              />
              <span className="text-muted-foreground text-xs">
                For example <Num kind="money" value="12480.50" compact />
              </span>
            </span>
          )}
        </SettingRow>
      </div>
    </NumberSettingsProvider>
  );
}

/**
 * Settings: Number format (blueprint "Number display", spec A4): decimals per kind, negative
 * style and compact dashboard numbers. Display only: stored values and totals never change, and
 * a rounded number shows its full value on hover.
 */
export function NumberFormatPage() {
  const can = useCan();
  const { settings } = useWorkspace();
  const defaults = useApiQuery((client) => client.getDefaultSettings(), []);
  if (!can("settings.numbers.manage")) return <NoAccess />;
  if (defaults.status !== "ready") return <QueryFallback query={defaults} className="h-96" label="Loading settings" />;
  return (
    <Panel bodyClassName="flex flex-col gap-6">
      <SettingsForm
        showTitle={false}
        title="Number format"
        description="How numbers look, never what is stored. People can also add or remove decimals per table column."
        initial={settings.numbers}
        defaults={defaults.data.numbers}
        onSave={(numbers) => api.updateSettings("numbers", numbers).then(() => {})}
      >
        {(draft, setDraft, changed) => <NumbersSection draft={draft} setDraft={setDraft} changed={changed} />}
      </SettingsForm>
    </Panel>
  );
}
