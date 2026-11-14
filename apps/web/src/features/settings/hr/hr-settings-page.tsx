"use client";

import Link from "next/link";
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  CALIFORNIA_PENDING_NOTE,
  californiaPayNote,
  californiaPayOn,
  companyOvertimeRule,
  OVERTIME_RULE_LABELS,
  payFrequencyProblem,
  WEEKDAY_LABELS,
  type HrSettings,
  type TimeOffPolicy,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Num } from "@workspace/ui/components/num";
import { Panel } from "@workspace/ui/components/panel";
import { Switch } from "@workspace/ui/components/switch";
import { NoAccess } from "@/components/no-access";
import { QueryFallback } from "@/components/query-fallback";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { useFormatDate } from "@/lib/use-format-date";
import { CaliforniaPayNote } from "@/features/hr/california-pay-note";
import { Choice } from "../form/choice";
import { SettingRow } from "../form/setting-row";
import { SettingsForm } from "../form/settings-form";
import type { SectionProps } from "../localization/simple-tabs";
import { PolicyDialog } from "./policy-dialog";

const FREQUENCY = {
  weekly: "Weekly",
  biweekly: "Every two weeks",
  semimonthly: "Twice a month",
  monthly: "Monthly",
} as const;
const WEEKDAYS = Object.fromEntries(WEEKDAY_LABELS.map((d, i) => [String(i), d])) as Record<string, string>;

/** Pay calendar, holidays and what employees may see (spec C1, ADR 0024). */
function HrSection({
  draft,
  setDraft,
  changed,
  frequencyProblem,
}: SectionProps<HrSettings> & { frequencyProblem: string | null }) {
  const formatDate = useFormatDate();
  const [holidayDate, setHolidayDate] = useState("");
  const [holidayName, setHolidayName] = useState("");
  const toggle = (
    key:
      | "showPayToEmployees"
      | "showCommissionToEmployees"
      | "showRatesToEmployees"
      | "showTeamCalendarToEmployees"
      | "clockEnabled",
  ) => (
    <SettingRow setting={`hr.${key}`} changed={changed(key)}>
      {(id) => (
        <Switch
          id={id}
          aria-describedby={`${id}-hint`}
          checked={draft[key]}
          onCheckedChange={(v) => setDraft({ ...draft, [key]: v })}
        />
      )}
    </SettingRow>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SettingRow setting="hr.workweekStartDay" changed={changed("workweekStartDay")}>
        {(id) => (
          <Choice
            id={id}
            value={String(draft.workweekStartDay)}
            options={WEEKDAYS}
            onChange={(v) => setDraft({ ...draft, workweekStartDay: Number(v) })}
          />
        )}
      </SettingRow>
      <SettingRow setting="hr.payFrequency" changed={changed("payFrequency")}>
        {(id) => (
          <>
            <Choice
              id={id}
              value={draft.payFrequency}
              options={FREQUENCY}
              onChange={(payFrequency) => setDraft({ ...draft, payFrequency })}
            />
            {frequencyProblem ? <p className="text-danger-ink mt-1 text-sm">{frequencyProblem}</p> : null}
          </>
        )}
      </SettingRow>
      {toggle("showPayToEmployees")}
      {toggle("showCommissionToEmployees")}
      {toggle("showRatesToEmployees")}
      {toggle("showTeamCalendarToEmployees")}
      {toggle("clockEnabled")}
      <div className="sm:col-span-2">
        <h3 className="mb-2 text-sm font-medium">Holidays</h3>
        <ul className="divide-hairline mb-3 max-h-56 divide-y overflow-y-auto text-sm">
          {draft.holidays.map((h) => (
            <li key={`${h.date}-${h.name}`} className="flex items-center justify-between gap-3 py-1.5">
              <span>
                {formatDate(h.date)}, {h.name}
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`Remove ${h.name} ${h.date}`}
                onClick={() => setDraft({ ...draft, holidays: draft.holidays.filter((x) => x !== h) })}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-2">
          <Input
            type="date"
            aria-label="Holiday date"
            className="w-40"
            value={holidayDate}
            onChange={(e) => setHolidayDate(e.target.value)}
          />
          <Input
            aria-label="Holiday name"
            className="w-56"
            placeholder="Company picnic"
            value={holidayName}
            onChange={(e) => setHolidayName(e.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            disabled={!holidayDate || !holidayName.trim()}
            onClick={() => {
              setDraft({
                ...draft,
                holidays: [...draft.holidays, { date: holidayDate, name: holidayName.trim() }].sort((a, b) =>
                  a.date.localeCompare(b.date),
                ),
              });
              setHolidayDate("");
              setHolidayName("");
            }}
          >
            <Plus />
            Add holiday
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Settings → HR (spec C1, audit U-30). */
export function HrSettingsPage() {
  const can = useCan();
  const { settings } = useWorkspace();
  const [editing, setEditing] = useState<TimeOffPolicy | "new" | null>(null);
  const data = useApiQuery(async (client) => {
    const [saved, defaults, hr] = await Promise.all([
      client.getSettings(),
      client.getDefaultSettings(),
      client.hrData(),
    ]);
    return { saved, defaults, policies: hr.timeOffPolicies, employees: hr.employees };
  }, []);
  if (!can("settings.hr.manage")) return <NoAccess />;
  if (data.status !== "ready") return <QueryFallback query={data} className="h-96" label="Loading HR settings" />;
  const { saved, defaults, policies, employees } = data.data;

  return (
    <div className="flex flex-col gap-6">
      <SettingsForm
        title="HR"
        description="The pay calendar, holidays and what employees see in their portal."
        initial={saved.hr}
        defaults={defaults.hr}
        canSave={(hr) => payFrequencyProblem(hr.payFrequency, employees) === null}
        onSave={(hr) => api.updateSettings("hr", hr).then(() => {})}
      >
        {(draft, setDraft, changed) => (
          <HrSection
            draft={draft}
            setDraft={setDraft}
            changed={changed}
            frequencyProblem={payFrequencyProblem(draft.payFrequency, employees)}
          />
        )}
      </SettingsForm>
      <Panel title="Overtime rule" bodyClassName="flex flex-col gap-3">
        <p className="text-sm">
          {OVERTIME_RULE_LABELS[companyOvertimeRule(settings.localization.payroll.overtimeRule)]}. Change it in{" "}
          <Link className="text-brand-ink underline underline-offset-2" href="/settings/localization?tab=payroll">
            Tax and localization, Payroll
          </Link>
          .{californiaPayOn() ? " Workers in California follow the California rule whatever is chosen." : null}
        </p>
        <CaliforniaPayNote
          note={
            californiaPayOn()
              ? CALIFORNIA_PENDING_NOTE
              : californiaPayNote(employees, settings.localization.payroll.overtimeRule)
          }
        />
      </Panel>
      <Panel
        title="Time-off policies"
        actions={
          <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
            <Plus />
            New policy
          </Button>
        }
        bodyClassName="p-0"
      >
        <ul className="divide-hairline divide-y text-sm">
          {policies.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span>
                <span className="font-medium">{p.name}</span>
                <span className="text-muted-foreground">
                  {" "}
                  {p.paid ? "paid" : "unpaid"}
                  {p.capHours ? (
                    <>
                      , capped at <Num kind="quantity" value={p.capHours} unit="hours" />
                    </>
                  ) : null}
                </span>
              </span>
              <Button size="sm" variant="ghost" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}>
                <Pencil />
                Edit
              </Button>
            </li>
          ))}
        </ul>
      </Panel>
      {editing ? <PolicyDialog policy={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
