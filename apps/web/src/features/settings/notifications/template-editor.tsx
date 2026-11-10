"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  renderTemplate,
  sampleValues,
  unknownTokens,
  type NotificationEvent,
  type NotificationRule,
  type OutboxMessage,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet";
import { Textarea } from "@workspace/ui/components/textarea";
import { Field } from "@/components/field";
import { api } from "@/lib/api";

interface TemplateEditorProps {
  event: NotificationEvent;
  rule: Pick<NotificationRule, "enabled" | "channels" | "subject" | "body">;
  /** The newest message of this kind; its values make the preview real (ADR 0020). */
  latest: OutboxMessage | undefined;
  onClose: () => void;
}

/**
 * Edits one event's email (spec A4): subject and body with the variables it offers, a live preview
 * from the newest real message of that kind or sample values, and Reset to default. A variable the
 * event does not offer is refused, so a template can never break.
 */
export function TemplateEditor({ event, rule, latest, onClose }: TemplateEditorProps) {
  const [subject, setSubject] = useState(rule.subject);
  const [body, setBody] = useState(rule.body);
  const [pending, setPending] = useState(false);
  const values = { ...sampleValues(event), ...(latest?.values ?? {}) };
  const bad = [...unknownTokens(subject, event), ...unknownTokens(body, event)];

  async function run(work: () => Promise<unknown>, done: string) {
    setPending(true);
    try {
      await work();
      toast.success(done);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Not saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{event.label}</SheetTitle>
          <SheetDescription>Goes to: {event.goesTo.toLowerCase()}.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-6">
          <Field id="tpl-subject" label="Subject">
            <Input id="tpl-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field id="tpl-body" label="Message">
            <Textarea id="tpl-body" rows={7} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          {bad.length ? (
            <p role="alert" className="text-danger-ink text-sm">
              This event has no {`{{ ${bad[0]} }}`}. Use one of the variables below.
            </p>
          ) : null}
          <div>
            <h3 className="mb-1 text-sm font-semibold">Variables</h3>
            <ul className="text-muted-foreground grid gap-1 text-xs sm:grid-cols-2">
              {Object.entries(event.variables).map(([name, v]) => (
                <li key={name}>
                  <code className="text-foreground">{`{{ ${name} }}`}</code> {v.label}
                </li>
              ))}
            </ul>
          </div>
          <div className="border-hairline bg-raised rounded-md border p-3 text-sm">
            <h3 className="text-muted-foreground mb-1 text-xs">Preview</h3>
            <p className="font-medium">{renderTemplate(subject, values).text}</p>
            <p className="mt-2 whitespace-pre-line">{renderTemplate(body, values).text}</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => void run(() => api.resetNotificationRule(event.key), "Template reset to default")}
            >
              Reset to default
            </Button>
            <Button
              type="button"
              disabled={pending || bad.length > 0}
              onClick={() =>
                void run(() => api.saveNotificationRule({ id: event.key, ...rule, subject, body }), "Template saved")
              }
            >
              Save template
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
