"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  effectiveRule,
  emailSettingsProblem,
  NOTIFICATION_EVENTS,
  NOTIFICATION_GROUPS,
  type EmailSettings,
  type NotificationEvent,
  type NotificationRule,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Input } from "@workspace/ui/components/input";
import { Panel } from "@workspace/ui/components/panel";
import { Switch } from "@workspace/ui/components/switch";
import { NoAccess } from "@/components/no-access";
import { QueryFallback } from "@/components/query-fallback";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { OutboxBanner } from "@/features/outbox/outbox-page";
import { SettingRow } from "../form/setting-row";
import { SettingsForm } from "../form/settings-form";
import { TemplateEditor } from "./template-editor";

/** Who the emails come from: the name people see, where replies go, and the sign-off. */
function SenderSection({
  draft,
  setDraft,
  changed,
}: {
  draft: EmailSettings;
  setDraft: (next: EmailSettings) => void;
  changed: (key: keyof EmailSettings) => boolean;
}) {
  const field = (key: keyof EmailSettings) => (
    <SettingRow setting={`email.${key}`} changed={changed(key)}>
      {(id) => (
        <Input
          id={id}
          aria-describedby={`${id}-hint`}
          value={draft[key]}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        />
      )}
    </SettingRow>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {field("senderName")}
      {field("replyTo")}
      {field("signature")}
    </div>
  );
}

function EventRow({
  event,
  rules,
  onEdit,
}: {
  event: NotificationEvent;
  rules: readonly NotificationRule[];
  onEdit: (event: NotificationEvent) => void;
}) {
  const rule = effectiveRule(event.key, rules);
  const save = (patch: Partial<Pick<NotificationRule, "enabled" | "channels">>) =>
    api
      .saveNotificationRule({ id: event.key, ...rule, ...patch })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Not saved."));
  return (
    <tr className="border-hairline border-b">
      <td className="py-2.5 pr-4">
        <span className="block font-medium">{event.label}</span>
        <span className="text-muted-foreground text-xs">{event.goesTo}</span>
      </td>
      <td className="px-3">
        <Switch
          aria-label={`${event.label} on`}
          checked={rule.enabled}
          onCheckedChange={(enabled) => void save({ enabled })}
        />
      </td>
      <td className="px-3">
        <Checkbox
          aria-label={`${event.label} by email`}
          checked={rule.channels.email}
          disabled={!rule.enabled}
          onCheckedChange={(email) => void save({ channels: { ...rule.channels, email: email === true } })}
        />
      </td>
      <td className="px-3">
        <Checkbox
          aria-label={`${event.label} in the app`}
          checked={rule.channels.inApp}
          disabled={!rule.enabled}
          onCheckedChange={(inApp) => void save({ channels: { ...rule.channels, inApp: inApp === true } })}
        />
      </td>
      <td className="py-1.5 text-right">
        <Button
          variant="outline"
          size="sm"
          aria-label={`Edit template for ${event.label}`}
          onClick={() => onEdit(event)}
        >
          <Pencil />
          Template
        </Button>
      </td>
    </tr>
  );
}

/**
 * Settings: Email and notifications (spec A4): the sender, then every event with an on/off switch,
 * its channels and a template with variables and a preview. The demo never sends real email; the
 * Outbox shows what would have gone.
 */
export function NotificationsSettingsPage() {
  const can = useCan();
  const { settings } = useWorkspace();
  const [editing, setEditing] = useState<NotificationEvent | null>(null);
  const data = useApiQuery(async (client) => {
    const [defaults, rules, outbox] = await Promise.all([
      client.getDefaultSettings(),
      client.list("notificationRules"),
      client.listOutbox(true),
    ]);
    return { defaults, rules, outbox };
  }, []);
  if (!can("settings.notifications.manage")) return <NoAccess />;
  if (data.status !== "ready") return <QueryFallback query={data} className="h-96" label="Loading notifications" />;
  const { defaults, rules, outbox } = data.data;
  const groups = Object.entries(NOTIFICATION_GROUPS) as [keyof typeof NOTIFICATION_GROUPS, string][];
  return (
    <div className="flex flex-col gap-6">
      <OutboxBanner />
      <Panel bodyClassName="flex flex-col gap-8">
        <SettingsForm
          title="Sender"
          description="The name and reply address people see on every email."
          initial={settings.email}
          defaults={defaults.email}
          // The shared rule first, then a code: who mail seems to come from and where replies go are
          // a phishing lever, so the API asks for a step-up on every save (ADR 0059, bell and Outbox part, D7).
          problem={emailSettingsProblem}
          stepUp
          onSave={(email) => api.updateSettings("email", email).then(() => {})}
        >
          {(draft, setDraft, changed) => <SenderSection draft={draft} setDraft={setDraft} changed={changed} />}
        </SettingsForm>
      </Panel>
      {groups.map(([group, label]) => (
        <Panel key={group} title={label}>
          <div role="region" aria-label={`${label} notifications`} tabIndex={0} className="relative overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="text-muted-foreground text-xs">
                <tr className="border-hairline border-b">
                  <th scope="col" className="h-9 pr-4 text-left font-medium">
                    Event
                  </th>
                  <th scope="col" className="px-3 text-left font-medium">
                    On
                  </th>
                  <th scope="col" className="px-3 text-left font-medium">
                    Email
                  </th>
                  <th scope="col" className="px-3 text-left font-medium">
                    In the app
                  </th>
                  <th scope="col">
                    <span className="sr-only">Template</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {NOTIFICATION_EVENTS.filter((e) => e.group === group).map((event) => (
                  <EventRow key={event.key} event={event} rules={rules} onEdit={setEditing} />
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}
      {editing ? (
        <TemplateEditor
          event={editing}
          rule={effectiveRule(editing.key, rules)}
          latest={outbox.find((m) => m.eventKey === editing.key)}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
