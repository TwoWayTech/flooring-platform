"use client";

import { PAYMENT_TERM_LABELS, type LocalizationSettings, type PaymentTerms } from "@workspace/shared";
import { Input } from "@workspace/ui/components/input";
import { Panel } from "@workspace/ui/components/panel";
import { Textarea } from "@workspace/ui/components/textarea";
import { NoAccess } from "@/components/no-access";
import { QueryFallback } from "@/components/query-fallback";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { Choice } from "../form/choice";
import { SettingRow } from "../form/setting-row";
import { SettingsForm } from "../form/settings-form";
import type { SectionProps } from "../localization/simple-tabs";

type Documents = LocalizationSettings["documents"];

/** Terms, late fee, deposit, numbering prefixes and the legal footer. */
function DocumentsSection({ draft, setDraft, changed }: SectionProps<Documents>) {
  const text = (key: "quotePrefix" | "invoicePrefix" | "poPrefix") => (
    <SettingRow setting={`documents.${key}`} changed={changed(key)}>
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
  const pct = (key: "lateFeePct" | "defaultDepositPct") => (
    <SettingRow setting={`documents.${key}`} changed={changed(key)}>
      {(id) => (
        <span className="flex items-center gap-1.5">
          <Input
            id={id}
            inputMode="decimal"
            aria-describedby={`${id}-hint`}
            value={draft[key]}
            onChange={(e) => setDraft({ ...draft, [key]: e.target.value.replace(/[^\d.]/g, "") })}
            className="w-24 text-right tabular-nums"
          />
          <span className="text-muted-foreground text-sm">%</span>
        </span>
      )}
    </SettingRow>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <SettingRow setting="documents.defaultTerms" changed={changed("defaultTerms")}>
        {(id) => (
          <Choice
            id={id}
            value={draft.defaultTerms}
            options={PAYMENT_TERM_LABELS}
            onChange={(defaultTerms: PaymentTerms) => setDraft({ ...draft, defaultTerms })}
          />
        )}
      </SettingRow>
      {pct("lateFeePct")}
      {pct("defaultDepositPct")}
      {text("quotePrefix")}
      {text("invoicePrefix")}
      {text("poPrefix")}
      <SettingRow setting="documents.legalFooter" changed={changed("legalFooter")} className="sm:col-span-3">
        {(id) => (
          <Textarea
            id={id}
            aria-describedby={`${id}-hint`}
            value={draft.legalFooter}
            onChange={(e) => setDraft({ ...draft, legalFooter: e.target.value })}
            rows={2}
          />
        )}
      </SettingRow>
    </div>
  );
}

/**
 * Settings: Sales and documents (spec A4): how quotes, invoices and orders are numbered, what they
 * ask for and what they print.
 */
export function DocumentsPage() {
  const can = useCan();
  const { settings } = useWorkspace();
  const defaults = useApiQuery((client) => client.getDefaultSettings(), []);
  if (!can("settings.localization.manage")) return <NoAccess />;
  if (defaults.status !== "ready") return <QueryFallback query={defaults} className="h-96" label="Loading settings" />;
  return (
    <Panel bodyClassName="flex flex-col gap-8">
      <SettingsForm
        showTitle={false}
        title="Documents"
        description="Payment terms, deposit, late fee and numbering for quotes, invoices and purchase orders."
        initial={settings.localization.documents}
        defaults={defaults.data.localization.documents}
        onSave={(documents) =>
          api.updateSettings("localization", { ...settings.localization, documents }).then(() => {})
        }
      >
        {(draft, setDraft, changed) => <DocumentsSection draft={draft} setDraft={setDraft} changed={changed} />}
      </SettingsForm>
    </Panel>
  );
}
