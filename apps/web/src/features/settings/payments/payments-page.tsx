"use client";

import {
  PAYMENT_CONTROLS_OWNER_ONLY,
  paymentControlsLoosened,
  paymentSettingsProblem,
  type PaymentSettings,
} from "@workspace/shared";
import { Input } from "@workspace/ui/components/input";
import { Panel } from "@workspace/ui/components/panel";
import { Switch } from "@workspace/ui/components/switch";
import { NoAccess } from "@/components/no-access";
import { QueryFallback } from "@/components/query-fallback";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { SettingRow } from "../form/setting-row";
import { SettingsForm } from "../form/settings-form";
import type { SectionProps } from "../localization/simple-tabs";

const money = (value: string) => value.replace(/[^\d.]/g, "");

/** The two-person check, the write-off limit and how payments and refunds are numbered. */
function PaymentsSection({ draft, setDraft, changed }: SectionProps<PaymentSettings>) {
  const amount = (key: "approvalThreshold" | "writeOffMax", disabled = false) => (
    <SettingRow setting={`payments.${key}`} changed={changed(key)}>
      {(id) => (
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-sm">$</span>
          <Input
            id={id}
            inputMode="decimal"
            aria-describedby={`${id}-hint`}
            value={draft[key]}
            disabled={disabled}
            onChange={(e) => setDraft({ ...draft, [key]: money(e.target.value) })}
            className="w-32 text-right tabular-nums"
          />
        </span>
      )}
    </SettingRow>
  );
  const prefix = (key: "paymentPrefix" | "refundPrefix") => (
    <SettingRow setting={`payments.${key}`} changed={changed(key)}>
      {(id) => (
        <Input
          id={id}
          aria-describedby={`${id}-hint`}
          value={draft[key]}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
          className="w-28"
        />
      )}
    </SettingRow>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SettingRow setting="payments.approvalRequired" changed={changed("approvalRequired")} className="sm:col-span-2">
        {(id) => (
          <Switch
            id={id}
            aria-describedby={`${id}-hint`}
            checked={draft.approvalRequired}
            onCheckedChange={(approvalRequired) => setDraft({ ...draft, approvalRequired })}
          />
        )}
      </SettingRow>
      {amount("approvalThreshold", !draft.approvalRequired)}
      {amount("writeOffMax")}
      {prefix("paymentPrefix")}
      {prefix("refundPrefix")}
    </div>
  );
}

/**
 * Settings: Payments (spec Appendix A): whether payments wait for a second person, above which
 * amount, the largest leftover that may be written off, and the PAY- and RF- prefixes. These are
 * fraud controls over money in and out, so saving asks for a step-up code once the shared rule has
 * passed the draft, and a refused value never costs one (ADR 0059 D5). Loosening a control is the
 * Owner's alone, refused here too before the code (ADR 0059, "2026-11-20").
 */
export function PaymentsSettingsPage() {
  const can = useCan();
  const { settings, access } = useWorkspace();
  const problem = (draft: PaymentSettings) =>
    paymentSettingsProblem(draft) ??
    (!access.isOwner && paymentControlsLoosened(draft, settings.payments) ? PAYMENT_CONTROLS_OWNER_ONLY : null);
  const defaults = useApiQuery((client) => client.getDefaultSettings(), []);
  if (!can("settings.payments.manage")) return <NoAccess />;
  if (defaults.status !== "ready") return <QueryFallback query={defaults} className="h-96" label="Loading settings" />;
  return (
    <Panel bodyClassName="flex flex-col gap-8">
      <SettingsForm
        showTitle={false}
        stepUp
        title="Payments"
        description="The two-person check on customer payments, small write-offs, and payment and refund numbering."
        initial={settings.payments}
        defaults={defaults.data.payments}
        problem={problem}
        onSave={(payments) => api.updateSettings("payments", payments).then(() => {})}
      >
        {(draft, setDraft, changed) => <PaymentsSection draft={draft} setDraft={setDraft} changed={changed} />}
      </SettingsForm>
    </Panel>
  );
}
