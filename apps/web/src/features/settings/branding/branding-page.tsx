"use client";

import { useState, type ChangeEvent } from "react";
import { CircleCheck, RotateCcw, Save, TriangleAlert, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { checkBrandColor, type Branding, type FloorPattern } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Panel } from "@workspace/ui/components/panel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { NoAccess } from "@/components/no-access";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { BrandPreview } from "./brand-preview";

const PATTERNS: Record<FloorPattern, string> = {
  herringbone: "Herringbone",
  "running-bond": "Running-bond plank",
  basketweave: "Basketweave",
};
const THEMES = { system: "Follow the device", light: "Light", dark: "Dark" } as const;
/** Logos are kept in this browser's demo storage, so they stay small. */
const MAX_LOGO_BYTES = 300_000;

/**
 * Settings: Branding (spec Tier 1): logo, brand color with a live preview and contrast check,
 * pattern and default theme. Saving applies the branding across the shell at once.
 */
export function BrandingPage() {
  const can = useCan();
  const { settings } = useWorkspace();
  const [draft, setDraft] = useState<Branding>(settings.branding);
  const [hex, setHex] = useState(settings.branding.brandColor);
  const check = checkBrandColor(hex);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings.branding);

  if (!can("settings.branding.manage")) return <NoAccess />;

  function setColor(value: string) {
    setHex(value);
    if (checkBrandColor(value).ok) setDraft((d) => ({ ...d, brandColor: value.toUpperCase() }));
  }

  function onLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      toast.error("That logo is larger than 300 KB. Use a smaller PNG or SVG.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setDraft((d) => ({ ...d, logoDataUrl: String(reader.result) }));
    reader.readAsDataURL(file);
  }

  async function save() {
    await api.updateSettings("branding", draft);
    toast.success("Branding saved");
  }

  async function reset() {
    const next = await api.resetSettings("branding");
    setDraft(next.branding);
    setHex(next.branding.brandColor);
    toast.success("Branding reset to the original");
  }

  return (
    <>
      <Panel title="Preview">
        <BrandPreview branding={draft} />
      </Panel>
      <Panel
        title="Branding"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void reset()}>
              <RotateCcw />
              Reset
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={!dirty}>
              <Save />
              Save branding
            </Button>
          </div>
        }
        bodyClassName="grid gap-5 sm:grid-cols-2"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="brand-name">Display name</Label>
          <Input
            id="brand-name"
            value={draft.displayName}
            onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="brand-monogram">Monogram letters</Label>
          <Input
            id="brand-monogram"
            value={draft.monogram}
            maxLength={2}
            onChange={(e) => setDraft({ ...draft, monogram: e.target.value.toUpperCase() })}
            className="w-20"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="brand-color">Brand color</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Pick brand color"
              value={draft.brandColor}
              onChange={(e) => setColor(e.target.value)}
              className="border-hairline h-9 w-12 cursor-pointer rounded-md border bg-transparent"
            />
            <Input
              id="brand-color"
              value={hex}
              onChange={(e) => setColor(e.target.value)}
              className="w-32 tabular-nums"
              aria-describedby="brand-color-check"
            />
          </div>
          <p
            id="brand-color-check"
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
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="brand-pattern">Floor pattern</Label>
          <Select value={draft.pattern} onValueChange={(v) => setDraft({ ...draft, pattern: v as FloorPattern })}>
            <SelectTrigger id="brand-pattern" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PATTERNS) as FloorPattern[]).map((p) => (
                <SelectItem key={p} value={p}>
                  {PATTERNS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Logo</span>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <label>
                <Upload />
                Upload logo
                <input type="file" accept="image/png,image/svg+xml,image/jpeg" className="sr-only" onChange={onLogo} />
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
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="brand-theme">Default theme</Label>
          <Select
            value={draft.defaultTheme}
            onValueChange={(v) => setDraft({ ...draft, defaultTheme: v as Branding["defaultTheme"] })}
          >
            <SelectTrigger id="brand-theme" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(THEMES) as Branding["defaultTheme"][]).map((t) => (
                <SelectItem key={t} value={t}>
                  {THEMES[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Panel>
    </>
  );
}
