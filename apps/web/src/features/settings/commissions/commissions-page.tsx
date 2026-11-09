"use client";

import { Plus, Trash2 } from "lucide-react";
import type { CommissionRule, CompanySettings } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Panel } from "@workspace/ui/components/panel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { NoAccess } from "@/components/no-access";
import { QueryFallback } from "@/components/query-fallback";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { SettingRow } from "../form/setting-row";
import { SettingsForm } from "../form/settings-form";

type Commissions = CompanySettings["commissions"];
const pct = (v: string) => v.replace(/[^\d.]/g, "");

/** Encodes who a rule is for as one select value. */
const whoOf = (r: CommissionRule) =>
  r.appliesTo.kind === "role" ? `role:${r.appliesTo.roleKey}` : `user:${r.appliesTo.userId}`;
const appliesFrom = (v: string): CommissionRule["appliesTo"] =>
  v.startsWith("role:") ? { kind: "role", roleKey: v.slice(5) } : { kind: "user", userId: v.slice(5) };

/** The rules editor: who, basis, rate and optional tiers per rule. */
function RulesSection({ draft, setDraft }: { draft: Commissions; setDraft: (d: Commissions) => void }) {
  const { roles } = useWorkspace();
  const users = useApiQuery((client) => client.list("users"), []);
  const update = (i: number, patch: Partial<CommissionRule>) =>
    setDraft({ rules: draft.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <SettingRow setting="commissions.rules" changed={false}>
      {(id) => (
        <div id={id} className="flex flex-col gap-3" aria-describedby={`${id}-hint`}>
          {draft.rules.map((rule, i) => (
            <fieldset
              key={rule.id}
              className="border-hairline grid gap-3 rounded-md border p-3 sm:grid-cols-[1fr_12rem_7rem_auto]"
            >
              <legend className="sr-only">Rule {i + 1}</legend>
              <Select value={whoOf(rule)} onValueChange={(v) => update(i, { appliesTo: appliesFrom(v) })}>
                <SelectTrigger aria-label={`Rule ${i + 1} applies to`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={`role:${r.key}`}>
                      Role: {r.name}
                    </SelectItem>
                  ))}
                  {(users.data ?? [])
                    .filter((u) => u.status === "active")
                    .map((u) => (
                      <SelectItem key={u.id} value={`user:${u.id}`}>
                        Person: {u.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Select value={rule.basis} onValueChange={(v) => update(i, { basis: v as CommissionRule["basis"] })}>
                <SelectTrigger aria-label={`Rule ${i + 1} basis`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="paid_revenue">Paid revenue</SelectItem>
                  <SelectItem value="gross_margin">Gross margin</SelectItem>
                </SelectContent>
              </Select>
              <span className="flex items-center gap-1">
                <Input
                  aria-label={`Rule ${i + 1} rate`}
                  inputMode="decimal"
                  value={rule.ratePct}
                  onChange={(e) => update(i, { ratePct: pct(e.target.value) })}
                  className="text-right tabular-nums"
                />
                <span className="text-muted-foreground text-sm">%</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove rule ${i + 1}`}
                onClick={() => setDraft({ rules: draft.rules.filter((_, j) => j !== i) })}
              >
                <Trash2 />
              </Button>
              <div className="flex flex-col gap-2 sm:col-span-4">
                {rule.tiers.map((tier, k) => (
                  <span key={k} className="flex flex-wrap items-center gap-2 text-sm">
                    From
                    <Input
                      aria-label={`Rule ${i + 1} tier ${k + 1} from amount`}
                      inputMode="decimal"
                      value={tier.fromAmount}
                      onChange={(e) =>
                        update(i, {
                          tiers: rule.tiers.map((t, m) => (m === k ? { ...t, fromAmount: pct(e.target.value) } : t)),
                        })
                      }
                      className="h-8 w-28 text-right tabular-nums"
                    />
                    in a period, earn
                    <Input
                      aria-label={`Rule ${i + 1} tier ${k + 1} rate`}
                      inputMode="decimal"
                      value={tier.ratePct}
                      onChange={(e) =>
                        update(i, {
                          tiers: rule.tiers.map((t, m) => (m === k ? { ...t, ratePct: pct(e.target.value) } : t)),
                        })
                      }
                      className="h-8 w-20 text-right tabular-nums"
                    />
                    %
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove tier ${k + 1} of rule ${i + 1}`}
                      onClick={() => update(i, { tiers: rule.tiers.filter((_, m) => m !== k) })}
                    >
                      <Trash2 />
                    </Button>
                  </span>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() => update(i, { tiers: [...rule.tiers, { fromAmount: "50000", ratePct: rule.ratePct }] })}
                >
                  <Plus />
                  Add tier
                </Button>
              </div>
            </fieldset>
          ))}
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() =>
              setDraft({
                rules: [
                  ...draft.rules,
                  {
                    id: `com-rule-${crypto.randomUUID().slice(0, 6)}`,
                    appliesTo: { kind: "role", roleKey: "sales" },
                    basis: "paid_revenue",
                    ratePct: "5",
                    tiers: [],
                  },
                ],
              })
            }
          >
            <Plus />
            Add rule
          </Button>
        </div>
      )}
    </SettingRow>
  );
}

/**
 * Settings: Commissions (spec E2): a rule per role or per person, a percent of paid revenue or of
 * gross margin, earned when payments are confirmed, with optional tiers. A person's own rule wins
 * over their role's.
 */
export function CommissionsPage() {
  const can = useCan();
  const { settings } = useWorkspace();
  const defaults = useApiQuery((client) => client.getDefaultSettings(), []);
  if (!can("sales.commission.manage")) return <NoAccess />;
  if (defaults.status !== "ready") return <QueryFallback query={defaults} className="h-96" label="Loading settings" />;
  return (
    <Panel bodyClassName="flex flex-col gap-8">
      <SettingsForm
        showTitle={false}
        title="Commissions"
        description="Who earns commission, on what, at which rate."
        initial={settings.commissions}
        defaults={defaults.data.commissions}
        onSave={(commissions) => api.updateSettings("commissions", commissions).then(() => {})}
      >
        {(draft, setDraft) => <RulesSection draft={draft} setDraft={setDraft} />}
      </SettingsForm>
    </Panel>
  );
}
