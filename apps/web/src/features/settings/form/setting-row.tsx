"use client";

import type { ReactNode } from "react";
import { Label } from "@workspace/ui/components/label";
import { cn } from "@workspace/ui/lib/utils";
import { SETTINGS, settingControlId, type SettingId } from "./registry";

interface SettingRowProps {
  setting: SettingId;
  /** Marks the row as changed since the last save (spec A4: changed fields are highlighted). */
  changed?: boolean;
  className?: string;
  /** The control, given the id its label points at. */
  children: (controlId: string) => ReactNode;
}

/**
 * One setting: its label, the control, then one short helper line (spec A4). A changed row gets
 * a tinted edge and the word "Changed", so the highlight never relies on colour alone.
 */
export function SettingRow({ setting, changed = false, className, children }: SettingRowProps) {
  const info = SETTINGS[setting];
  const id = settingControlId(setting);
  return (
    <div
      id={`${id}-row`}
      data-changed={changed || undefined}
      className={cn(
        "flex scroll-mt-24 flex-col gap-1.5 rounded-md border-l-2 border-transparent py-1 pl-3",
        changed && "border-brand bg-brand-soft/40",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Label id={`${id}-label`} htmlFor={id}>
          {info.label}
        </Label>
        {changed ? <span className="text-brand-ink text-xs font-medium">Changed</span> : null}
      </div>
      {children(id)}
      <p id={`${id}-hint`} className="text-muted-foreground text-xs">
        {info.helper}
      </p>
    </div>
  );
}
