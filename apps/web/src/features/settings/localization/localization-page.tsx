"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { LocalizationSettings } from "@workspace/shared";
import { Panel } from "@workspace/ui/components/panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { NoAccess } from "@/components/no-access";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { SectionForm } from "./section-form";
import { CurrencyTab, DocumentsTab, PayrollTab, RegionTab } from "./simple-tabs";
import { TaxTab } from "./tax-tab";

const TABS = {
  region: "Region",
  currency: "Currency",
  tax: "Sales tax",
  payroll: "Payroll rules",
  documents: "Documents",
} as const;
type Tab = keyof typeof TABS;

/**
 * Settings: Localization and tax (blueprint "Localization, currency and tax settings"): the one
 * place for everything that changes a company's calculations. Each tab saves on its own.
 */
export function LocalizationPage() {
  const can = useCan();
  const router = useRouter();
  const params = useSearchParams();
  const { settings } = useWorkspace();
  const canLocal = can("settings.localization.manage");
  const canTax = can("settings.tax.manage");
  if (!canLocal && !canTax) return <NoAccess />;
  const requested = params.get("tab") as Tab | null;
  const tab: Tab = requested && requested in TABS ? requested : canLocal ? "region" : "tax";
  const loc = settings.localization;
  const save =
    <K extends keyof LocalizationSettings>(key: K) =>
    async (value: LocalizationSettings[K]) => {
      await api.updateSettings("localization", { ...settings.localization, [key]: value });
    };

  return (
    <Panel bodyClassName="flex flex-col gap-5">
      <Tabs value={tab} onValueChange={(v) => router.replace(`/settings/localization?tab=${v}`)}>
        <div className="scrollbar-none -mx-4 overflow-x-auto px-4">
          <TabsList aria-label="Localization and tax">
            {(Object.keys(TABS) as Tab[])
              .filter((t) => (t === "tax" ? canTax : canLocal))
              .map((t) => (
                <TabsTrigger key={t} value={t}>
                  {TABS[t]}
                </TabsTrigger>
              ))}
          </TabsList>
        </div>
        <TabsContent value="region" className="pt-4">
          <SectionForm title="Region" initial={loc.region} onSave={save("region")}>
            {(draft, setDraft) => <RegionTab draft={draft} setDraft={setDraft} />}
          </SectionForm>
        </TabsContent>
        <TabsContent value="currency" className="pt-4">
          <SectionForm title="Currency" initial={loc.currency} stepUp onSave={save("currency")}>
            {(draft, setDraft) => <CurrencyTab draft={draft} setDraft={setDraft} />}
          </SectionForm>
        </TabsContent>
        <TabsContent value="tax" className="pt-4">
          <SectionForm title="Sales tax" initial={loc.tax} stepUp onSave={save("tax")}>
            {(draft, setDraft) => <TaxTab draft={draft} setDraft={setDraft} />}
          </SectionForm>
        </TabsContent>
        <TabsContent value="payroll" className="pt-4">
          <SectionForm title="Payroll rules" initial={loc.payroll} onSave={save("payroll")}>
            {(draft, setDraft) => <PayrollTab draft={draft} setDraft={setDraft} />}
          </SectionForm>
        </TabsContent>
        <TabsContent value="documents" className="pt-4">
          <SectionForm title="Documents" initial={loc.documents} onSave={save("documents")}>
            {(draft, setDraft) => <DocumentsTab draft={draft} setDraft={setDraft} />}
          </SectionForm>
        </TabsContent>
      </Tabs>
    </Panel>
  );
}
