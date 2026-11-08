"use client";

import type { ChangeEvent } from "react";
import { CircleCheck, TriangleAlert, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { checkBrandColor, type Branding, type FloorPattern } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Panel } from "@workspace/ui/components/panel";
import { NoAccess } from "@/components/no-access";
import { QueryFallback } from "@/components/query-fallback";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { Choice } from "../form/choice";
import { SettingRow } from "../form/setting-row";
import { SettingsForm } from "../form/settings-form";
import type { SectionProps } from "../localization/simple-tabs";
import { BrandPreview } from "./brand-preview";

const PATTERNS: Record<FloorPattern, string> = {
  herringbone: "Herringbone",
  "running-bond": "Running-bond plank",
  basketweave: "Basketweave",
};
const THEMES = { system: "Follow the device", light: "Light", dark: "Dark" } as const;
/** Logos are kept in this browser's demo storage, so they stay small. */
const MAX_LOGO_BYTES = 300_000;

/** The branding rows, with a live preview that only ever shows a readable color. */
function BrandingSection({ draft, setDraft, changed, saved }: SectionProps<Branding> & { saved: Branding }) {
  const check = checkBrandColor(draft.brandColor);

  function onLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      toast.error("That logo is larger than 300 KB. Use a smaller PNG or SVG.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setDraft({ ...draft, logoDataUrl: String(reader.result) });
    reader.readAsDataURL(file);
  }

  return (
    <>
      <BrandPreview branding={{ ...draft, brandColor: check.ok ? draft.brandColor : saved.brandColor }} />
      <div className="grid gap-5 sm:grid-cols-2">
        <SettingRow setting="branding.displayName" changed={changed("displayName")}>
          {(id) => (
            <Input
              id={id}
              aria-describedby={`${id}-hint`}
              value={draft.displayName}
              onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
            />
          )}
        </SettingRow>
        <SettingRow setting="branding.monogram" changed={changed("monogram")}>
          {(id) => (
            <Input
              id={id}
              aria-describedby={`${id}-hint`}
              value={draft.monogram}
              maxLength={2}
              onChange={(e) => setDraft({ ...draft, monogram: e.target.value.toUpperCase() })}
              className="w-20"
            />
          )}
        </SettingRow>
        <SettingRow setting="branding.brandColor" changed={changed("brandColor")}>
          {(id) => (
            <>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Pick brand color"
                  value={check.ok ? draft.brandColor : saved.brandColor}
                  onChange={(e) => setDraft({ ...draft, brandColor: e.target.value.toUpperCase() })}
                  className="border-hairline h-9 w-12 cursor-pointer rounded-md border bg-transparent"
                />
                <Input
                  id={id}
                  value={draft.brandColor}
                  onChange={(e) => setDraft({ ...draft, brandColor: e.target.value.trim().toUpperCase() })}
                  className="w-32 tabular-nums"
                  aria-describedby={`${id}-check ${id}-hint`}
                  aria-invalid={!check.ok}
                />
              </div>
              <p
                id={`${id}-check`}
                className={
                  check.ok
                    ? "text-success-ink flex items-center gap-1.5 text-xs"
                    : "text-danger-ink flex items-center gap-1.5 text-xs"
                }
              >
                {check.ok ? (
                  <CircleCheck aria-hidden="true" className="size-3.5" />
                ) : (
                  <TriangleAlert aria-hidden="true" className="size-3.5" />
                )}
                {check.message}
              </p>
            </>
          )}
        </SettingRow>
        <SettingRow setting="branding.pattern" changed={changed("pattern")}>
          {(id) => (
            <Choice
              id={id}
              value={draft.pattern}
              options={PATTERNS}
              onChange={(pattern) => setDraft({ ...draft, pattern })}
            />
          )}
        </SettingRow>
        <SettingRow setting="branding.logo" changed={changed("logoDataUrl")}>
          {(id) => (
            <div id={id} className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <label>
                  <Upload />
                  Upload logo
                  <input
                    type="file"
                    accept="image/png,image/svg+xml,image/jpeg"
                    className="sr-only"
                    onChange={onLogo}
                  />
                </label>
              </Button>
              {draft.logoDataUrl ? (
                <Button variant="ghost" size="sm" onClick={() => setDraft({ ...draft, logoDataUrl: null })}>
                  <X />
                  Use the monogram
                </Button>
              ) : (
                <span className="text-muted-foreground text-xs">PNG, SVG or JPEG up to 300 KB</span>
              )}
            </div>
          )}
        </SettingRow>
        <SettingRow setting="branding.defaultTheme" changed={changed("defaultTheme")}>
          {(id) => (
            <Choice
              id={id}
              value={draft.defaultTheme}
              options={THEMES}
              onChange={(defaultTheme) => setDraft({ ...draft, defaultTheme })}
            />
          )}
        </SettingRow>
      </div>
    </>
  );
}

/**
 * Settings: Branding (spec Tier 1, A4): logo, brand color with a live preview and contrast check,
 * pattern and default theme. Saving applies the branding across the shell at once.
 */
export function BrandingPage() {
  const can = useCan();
  const { settings } = useWorkspace();
  const defaults = useApiQuery((client) => client.getDefaultSettings(), []);
  if (!can("settings.branding.manage")) return <NoAccess />;
  if (defaults.status !== "ready") return <QueryFallback query={defaults} className="h-96" label="Loading settings" />;
  return (
    <Panel bodyClassName="flex flex-col gap-6">
      <SettingsForm
        showTitle={false}
        title="Branding"
        description="How the company looks in the app and on documents: name, logo, color and theme."
        initial={settings.branding}
        defaults={defaults.data.branding}
        canSave={(draft) => checkBrandColor(draft.brandColor).ok}
        onSave={(branding) => api.updateSettings("branding", branding).then(() => {})}
      >
        {(draft, setDraft, changed) => (
          <BrandingSection draft={draft} setDraft={setDraft} changed={changed} saved={settings.branding} />
        )}
      </SettingsForm>
    </Panel>
  );
}
