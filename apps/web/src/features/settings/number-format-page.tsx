"use client";

import { useState } from "react";
import { Minus, Plus, Save } from "lucide-react";
import { toast } from "sonner";
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
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";

const UNITS: Partial<Record<NumberKind, string>> = { quantity: "sq ft", count: "cartons" };

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

/**
 * Settings: Number format (blueprint "Number display"): decimals per kind, negative style and
 * compact dashboard numbers. Display only: stored values and totals never change, and a
 * rounded number shows its full value on hover.
 */
export function NumberFormatPage() {
  const can = useCan();
  const { settings } = useWorkspace();
  const [draft, setDraft] = useState<NumberSettings>(settings.numbers);
  if (!can("settings.numbers.manage")) return <NoAccess />;
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings.numbers);

  async function save() {
    await api.updateSettings("numbers", draft);
    toast.success("Number format saved");
  }

  return (
    <NumberSettingsProvider settings={draft}>
      <Panel
        title="Number format"
        actions={
          <Button size="sm" onClick={() => void save()} disabled={!dirty}>
            <Save />
            Save number format
          </Button>
        }
        bodyClassName="flex flex-col gap-6"
      >
        <p className="text-muted-foreground max-w-prose text-sm">
          These settings change how numbers look, never what is stored. Totals keep full precision; hover a rounded
          number to see its full value. People can also add or remove decimals per table column for themselves.
        </p>
        <ScrollRegion label="Number formats" className="border-hairline rounded-md border">
          <table className="w-full min-w-[32rem] text-sm">
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
        <div className="grid gap-6 sm:grid-cols-2">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Negative numbers</legend>
            <RadioGroup
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
          </fieldset>
          <div className="flex items-start justify-between gap-4">
            <Label htmlFor="compact" className="flex flex-col items-start gap-1 font-normal">
              <span className="font-medium">Compact numbers on dashboards</span>
              <span className="text-muted-foreground text-xs">
                Shows <Num kind="money" value="12480.50" compact /> instead of the full amount.
              </span>
            </Label>
            <Switch
              id="compact"
              checked={draft.compactDashboards}
              onCheckedChange={(compactDashboards) => setDraft({ ...draft, compactDashboards })}
            />
          </div>
        </div>
      </Panel>
    </NumberSettingsProvider>
  );
}
