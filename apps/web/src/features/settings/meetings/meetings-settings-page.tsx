"use client";

import type { MeetingSettings } from "@workspace/shared";
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

const REMINDERS = {
  "10": "10 minutes before",
  "15": "15 minutes before",
  "30": "30 minutes before",
  "60": "1 hour before",
};
const HANDLING = {
  contact: "Save as a new customer contact",
  lead: "Save as a new lead",
  none: "Don't save",
} as const;

/** Default reminder, what happens to new guests, and the invite defaults (spec E, ADR 0021). */
function MeetingsSection({ draft, setDraft, changed }: SectionProps<MeetingSettings>) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SettingRow setting="meetings.defaultReminderMin" changed={changed("defaultReminderMin")}>
        {(id) => (
          <Choice
            id={id}
            value={String(draft.defaultReminderMin)}
            options={REMINDERS}
            onChange={(v) => setDraft({ ...draft, defaultReminderMin: Number(v) })}
          />
        )}
      </SettingRow>
      <SettingRow setting="meetings.newGuestHandling" changed={changed("newGuestHandling")}>
        {(id) => (
          <Choice
            id={id}
            value={draft.newGuestHandling}
            options={HANDLING}
            onChange={(newGuestHandling) => setDraft({ ...draft, newGuestHandling })}
          />
        )}
      </SettingRow>
      <SettingRow setting="meetings.allowProposals" changed={changed("allowProposals")}>
        {(id) => (
          <Switch
            id={id}
            aria-describedby={`${id}-hint`}
            checked={draft.allowProposals}
            onCheckedChange={(allowProposals) => setDraft({ ...draft, allowProposals })}
          />
        )}
      </SettingRow>
      <SettingRow setting="meetings.hideGuestList" changed={changed("hideGuestList")}>
        {(id) => (
          <Switch
            id={id}
            aria-describedby={`${id}-hint`}
            checked={draft.hideGuestList}
            onCheckedChange={(hideGuestList) => setDraft({ ...draft, hideGuestList })}
          />
        )}
      </SettingRow>
    </div>
  );
}

/** Settings → Meetings (spec E). */
export function MeetingsSettingsPage() {
  const can = useCan();
  const { settings } = useWorkspace();
  const defaults = useApiQuery((client) => client.getDefaultSettings(), []);
  if (!can("settings.meetings.manage")) return <NoAccess />;
  if (defaults.status !== "ready")
    return <QueryFallback query={defaults} className="h-64" label="Loading meeting settings" />;
  return (
    <Panel title="Meetings">
      <SettingsForm
        showTitle={false}
        title="Meetings"
        description="Reminders, and what happens to guests added by email."
        initial={settings.meetings}
        defaults={defaults.data.meetings}
        onSave={(meetings) => api.updateSettings("meetings", meetings).then(() => {})}
      >
        {(draft, setDraft, changed) => <MeetingsSection draft={draft} setDraft={setDraft} changed={changed} />}
      </SettingsForm>
    </Panel>
  );
}
