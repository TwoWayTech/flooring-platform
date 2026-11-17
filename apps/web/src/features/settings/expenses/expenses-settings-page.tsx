"use client";

import {
  expenseSettingsProblem,
  fixedPctProblem,
  type ExpenseSettings,
  type Location,
  type SharedCostSettings,
} from "@workspace/shared";
import { Input } from "@workspace/ui/components/input";
import { Panel } from "@workspace/ui/components/panel";
import { Switch } from "@workspace/ui/components/switch";
import { NoAccess } from "@/components/no-access";
import { QueryFallback } from "@/components/query-fallback";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { Choice } from "../form/choice";
import { SettingRow } from "../form/setting-row";
import { SettingsForm } from "../form/settings-form";
import type { SectionProps } from "../localization/simple-tabs";

const RULES = {
  revenue: "By each location's revenue share",
  floor_area: "By floor area",
  equal: "Equally",
  fixed: "Fixed percentages",
} as const;

function ApprovalSection({ draft, setDraft, changed }: SectionProps<ExpenseSettings>) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SettingRow setting="expenses.approvalRequired" changed={changed("approvalRequired")}>
        {(id) => (
          <Switch
            id={id}
            aria-describedby={`${id}-hint`}
            checked={draft.approvalRequired}
            onCheckedChange={(approvalRequired) => setDraft({ ...draft, approvalRequired })}
          />
        )}
      </SettingRow>
      <SettingRow setting="expenses.approvalThreshold" changed={changed("approvalThreshold")}>
        {(id) => (
          <Input
            id={id}
            aria-describedby={`${id}-hint`}
            inputMode="decimal"
            className="w-32 text-right tabular-nums"
            value={draft.approvalThreshold}
            disabled={!draft.approvalRequired}
            onChange={(e) => setDraft({ ...draft, approvalThreshold: e.target.value.replace(/[^\d.]/g, "") })}
          />
        )}
      </SettingRow>
    </div>
  );
}

function SharingSection({
  draft,
  setDraft,
  changed,
  locations,
}: SectionProps<SharedCostSettings> & { locations: readonly Location[] }) {
  const problem = fixedPctProblem(draft, locations);
  return (
    <div className="flex flex-col gap-4">
      <SettingRow setting="sharedCosts.rule" changed={changed("rule")}>
        {(id) => (
          <Choice id={id} value={draft.rule} options={RULES} onChange={(rule) => setDraft({ ...draft, rule })} />
        )}
      </SettingRow>
      {draft.rule === "fixed" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {locations.map((l) => (
            <label key={l.id} className="flex items-center justify-between gap-3 text-sm">
              {l.name}
              <Input
                aria-label={`${l.name} percent`}
                inputMode="decimal"
                className="w-24 text-right tabular-nums"
                value={draft.fixedPct[l.id] ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, fixedPct: { ...draft.fixedPct, [l.id]: e.target.value.replace(/[^\d.]/g, "") } })
                }
              />
            </label>
          ))}
        </div>
      ) : null}
      {problem ? (
        <p role="alert" className="text-danger-ink text-sm">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/** Settings → Expenses (spec F1): approval above an amount and how company-wide costs are shared. */
export function ExpensesSettingsPage() {
  const can = useCan();
  const { settings } = useWorkspace();
  const data = useApiQuery(async (client) => {
    const [defaults, locations] = await Promise.all([client.getDefaultSettings(), client.list("locations")]);
    return { defaults, locations };
  }, []);
  if (!can("settings.expenses.manage")) return <NoAccess />;
  if (data.status !== "ready") return <QueryFallback query={data} className="h-64" label="Loading expense settings" />;
  const { defaults, locations } = data.data;
  return (
    <div className="flex flex-col gap-6">
      <Panel title="Approval">
        <SettingsForm
          showTitle={false}
          title="Expense approval"
          description="Expenses above this amount wait for a second person."
          initial={settings.expenses}
          defaults={defaults.expenses}
          problem={expenseSettingsProblem}
          onSave={(expenses) => api.updateSettings("expenses", expenses).then(() => {})}
        >
          {(draft, setDraft, changed) => <ApprovalSection draft={draft} setDraft={setDraft} changed={changed} />}
        </SettingsForm>
      </Panel>
      <Panel title="Shared costs">
        <SettingsForm
          showTitle={false}
          title="Shared costs"
          description="How company-wide costs are split across locations in the business report."
          initial={settings.sharedCosts}
          defaults={defaults.sharedCosts}
          canSave={(draft) => fixedPctProblem(draft, locations) === null}
          onSave={(sharedCosts) => api.updateSettings("sharedCosts", sharedCosts).then(() => {})}
        >
          {(draft, setDraft, changed) => (
            <SharingSection draft={draft} setDraft={setDraft} changed={changed} locations={locations} />
          )}
        </SettingsForm>
      </Panel>
    </div>
  );
}
