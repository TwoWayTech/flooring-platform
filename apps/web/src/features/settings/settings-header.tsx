"use client";

import { usePathname } from "next/navigation";
import { PageHeader } from "@workspace/ui/components/page-header";
import { useWorkspace } from "@/components/workspace/workspace-context";

/**
 * The title of a settings page and the one sentence saying what it controls (spec A4), taken
 * from its entry in the settings menu so every page reads the same way.
 */
export function SettingsHeader() {
  const { product } = useWorkspace();
  const pathname = usePathname();
  const page = product.settings.find((item) => pathname.startsWith(item.href));
  if (!page) {
    return (
      <PageHeader
        title="Settings"
        description="Everything your company can set, by group. Search to jump straight to one setting."
      />
    );
  }
  return <PageHeader title={page.label} description={page.description} />;
}
