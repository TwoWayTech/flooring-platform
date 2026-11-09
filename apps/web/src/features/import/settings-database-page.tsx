"use client";

import { NoAccess } from "@/components/no-access";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { ConnectDatabase } from "./connect-database";

/** Settings → Connect a database (spec G2), with the same access as data import. */
export function SettingsDatabasePage() {
  const { company } = useWorkspace();
  const can = useCan();
  if (!can("settings.import.manage")) return <NoAccess />;
  return <ConnectDatabase companyId={company.id} importHref="/settings/import" />;
}
