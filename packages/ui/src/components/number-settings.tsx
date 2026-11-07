"use client";

import { createContext, useContext, type ReactNode } from "react";
import { defaultNumberSettings, type NumberSettings } from "@workspace/shared";

const NumberSettingsContext = createContext<NumberSettings>(defaultNumberSettings());

/** Supplies the open company's number format to every <Num> below it. */
export function NumberSettingsProvider({ settings, children }: { settings: NumberSettings; children: ReactNode }) {
  return <NumberSettingsContext.Provider value={settings}>{children}</NumberSettingsContext.Provider>;
}

/** The number format in effect (Settings: Number format). */
export function useNumberSettings(): NumberSettings {
  return useContext(NumberSettingsContext);
}
