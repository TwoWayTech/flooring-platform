"use client";

import {
  EXPENSE_APPROVAL_OWNER_ONLY,
  expenseApprovalLoosened,
  expenseSettingsProblem,
  PERCENT_TEXT_MAX,
  sharedCostsProblem,
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

/**
 * The shares with one location's typed share: digits and a point only, and a cleared input drops the
 * share, so the location counts 0 and no blank is ever sent (ADR 0059, part 4b, D4).
 */
function withShare(shares: Record<string, string>, id: string, typed: string): Record<string, string> {
  const share = typed.replace(/[^\d.]/g, "");
  const next = { ...shares };
  if (share === "") delete next[id];
  else next[id] = share;
  return next;
}

function SharingSection({
  draft,
  setDraft,
  changed,
  locations,
}: SectionProps<SharedCostSettings> & { locations: readonly Location[] }) {
  // The shared rule both modes and the API run, with their words (ADR 0059, part 4b, D4).
  const problem = sharedCostsProblem(draft, locations);
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
                maxLength={PERCENT_TEXT_MAX}
                value={draft.fixedPct[l.id] ?? ""}
                onChange={(e) => setDraft({ ...draft, fixedPct: withShare(draft.fixedPct, l.id, e.target.value) })}
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

/**
 * Settings → Expenses (spec F1): approval above an amount and how company-wide costs are shared.
 * Switching approval off or raising its amount loosens the two-person check, so it is the Owner's
 * alone and asks for a step-up code; the shared rule and the Owner-only words run first, so a
 * refused value never costs a code (owner's decision 6, ADR 0061; ADR 0063). Tightening needs no code.
 */
export function ExpensesSettingsPage() {
  const can = useCan();
  const { settings, access } = useWorkspace();
  const loosens = (draft: ExpenseSettings) => expenseApprovalLoosened(draft, settings.expenses);
  const approvalProblem = (draft: ExpenseSettings) =>
    expenseSettingsProblem(draft) ?? (!access.isOwner && loosens(draft) ? EXPENSE_APPROVAL_OWNER_ONLY : null);
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
          problem={approvalProblem}
          stepUp={loosens}
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
          problem={(draft) => sharedCostsProblem(draft, locations)}
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
