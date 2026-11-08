import type { ReactNode } from "react";
import { SettingsHeader } from "@/features/settings/settings-header";
import { SettingsNav } from "@/features/settings/settings-nav";

/** Every settings page: its title and one sentence, the settings navigation, then the page. */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SettingsHeader />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <SettingsNav />
        <div className="flex min-w-0 flex-col gap-6">{children}</div>
      </div>
    </>
  );
}
