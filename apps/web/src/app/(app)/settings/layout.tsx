import type { ReactNode } from "react";
import { SettingsFrame } from "@/features/settings/settings-frame";
import { SettingsHeader } from "@/features/settings/settings-header";

/** Every settings page: its title and one sentence, the settings navigation, then the page. */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SettingsHeader />
      <SettingsFrame>{children}</SettingsFrame>
    </>
  );
}
