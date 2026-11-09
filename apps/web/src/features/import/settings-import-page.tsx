"use client";

import { NoAccess } from "@/components/no-access";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { useFormatDate } from "@/lib/use-format-date";
import { ImportWorkspace } from "./import-workspace";

/** Settings → Data import (spec G1), for people whose role holds settings.import.manage. */
export function SettingsImportPage() {
  const { company } = useWorkspace();
  const can = useCan();
  const formatDate = useFormatDate();
  if (!can("settings.import.manage")) return <NoAccess />;
  return <ImportWorkspace companyId={company.id} formatDate={formatDate} />;
}
