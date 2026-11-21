"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { overtimeRuleChanged, type LocalizationSettings } from "@workspace/shared";
import { Panel } from "@workspace/ui/components/panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { NoAccess } from "@/components/no-access";
import { QueryFallback } from "@/components/query-fallback";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { SettingsForm } from "../form/settings-form";
import { CurrencyTab, PayrollTab, regionCurrencyForms, RegionTab } from "./simple-tabs";
import { taxForm, TaxTab } from "./tax-tab";

/** The tabs: title, the sentence saying what each controls (spec A4), and whether it needs step-up. */
const TABS = {
  region: {
    title: "Region",
    description: "Where the company works and how dates, weeks and areas read across the app.",
    stepUp: false,
  },
  currency: {
    title: "Currency",
    description: "The base currency and rates for bills in other currencies.",
    stepUp: true,
  },
  tax: {
    title: "Sales tax",
    description: "What is taxed where and at which rate; quotes and invoices use these rules.",
    stepUp: true,
  },
  payroll: {
    title: "Payroll rules",
    description: "How overtime is flagged on timesheets, and how often payroll runs.",
    stepUp: false,
  },
} as const;
type Tab = keyof typeof TABS;

/**
 * Settings: Localization and tax (blueprint "Localization, currency and tax settings"): the place
 * for everything that changes a company's calculations. Each tab saves on its own. Region asks for
 * a code only when the states of operation change, Currency always; both run their shared rule
 * first (ADR 0059, part 2b). Payroll rules asks only when the overtime rule changes (ADR 0063). Sales tax runs its shared rule before the code, keeps what it can't
 * change on Reset, and remounts when the tab in force changes, so a save shows its own dates (part 3a).
 */
export function LocalizationPage() {
  const can = useCan();
  const router = useRouter();
  const params = useSearchParams();
  const { settings } = useWorkspace();
  const defaults = useApiQuery((client) => client.getDefaultSettings(), []);
  const canLocal = can("settings.localization.manage");
  const canTax = can("settings.tax.manage");
  if (!canLocal && !canTax) return <NoAccess />;
  const requested = params.get("tab") as Tab | null;
  const tab: Tab = requested && requested in TABS ? requested : canLocal ? "region" : "tax";
  if (defaults.status !== "ready") return <QueryFallback query={defaults} className="h-96" label="Loading settings" />;
  const loc = settings.localization;
  const original = defaults.data.localization;
  const save =
    <K extends keyof LocalizationSettings>(key: K) =>
    async (value: LocalizationSettings[K]) => {
      await api.updateLocalization(key, value);
    };
  const form = <K extends Tab>(key: K) => ({
    ...TABS[key],
    initial: loc[key],
    defaults: original[key],
    onSave: save(key),
  });
  // Region and Currency replace `defaults` and, for Region, `stepUp` (ADR 0059, part 2b).
  const forms = regionCurrencyForms(loc, original, can);
  // Sales tax replaces `defaults` and remounts after a save (ADR 0059, part 3a, D27).
  const { revision, ...tax } = taxForm(loc.tax, original.tax, can);

  return (
    <Panel bodyClassName="flex flex-col gap-5">
      <Tabs value={tab} onValueChange={(v) => router.replace(`/settings/localization?tab=${v}`)}>
        <div className="scrollbar-none -mx-4 overflow-x-auto px-4">
          <TabsList aria-label="Localization and tax">
            {(Object.keys(TABS) as Tab[])
              .filter((t) => (t === "tax" ? canTax : canLocal))
              .map((t) => (
                <TabsTrigger key={t} value={t}>
                  {TABS[t].title}
                </TabsTrigger>
              ))}
          </TabsList>
        </div>
        <TabsContent value="region" className="pt-4">
          <SettingsForm {...form("region")} {...forms.region}>
            {(draft, setDraft, changed) => <RegionTab draft={draft} setDraft={setDraft} changed={changed} />}
          </SettingsForm>
        </TabsContent>
        <TabsContent value="currency" className="pt-4">
          <SettingsForm {...form("currency")} {...forms.currency}>
            {(draft, setDraft, changed) => <CurrencyTab draft={draft} setDraft={setDraft} changed={changed} />}
          </SettingsForm>
        </TabsContent>
        <TabsContent value="tax" className="pt-4">
          <SettingsForm key={revision} {...form("tax")} {...tax}>
            {(draft, setDraft, changed) => <TaxTab draft={draft} setDraft={setDraft} changed={changed} />}
          </SettingsForm>
        </TabsContent>
        <TabsContent value="payroll" className="pt-4">
          <SettingsForm
            {...form("payroll")}
            stepUp={(draft: LocalizationSettings["payroll"]) => overtimeRuleChanged(draft, loc.payroll)}
          >
            {(draft, setDraft, changed) => <PayrollTab draft={draft} setDraft={setDraft} changed={changed} />}
          </SettingsForm>
        </TabsContent>
      </Tabs>
    </Panel>
  );
}
