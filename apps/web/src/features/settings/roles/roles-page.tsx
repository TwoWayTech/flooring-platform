"use client";

import { useState } from "react";
import { Lock, Plus } from "lucide-react";
import type { Role } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Panel } from "@workspace/ui/components/panel";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { cn } from "@workspace/ui/lib/utils";
import { NoAccess } from "@/components/no-access";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { useApiQuery } from "@/lib/api/use-api";
import { RoleEditor } from "./role-editor";

/** A new, unsaved role for this company: copied from another role, or empty. */
function draftRole(companyId: Role["companyId"], from?: Role): Role {
  return {
    id: `${companyId}-role-${crypto.randomUUID().slice(0, 8)}`,
    companyId,
    key: "custom",
    name: from ? `Copy of ${from.name}` : "New role",
    description: from?.description ?? "",
    permissions: from ? [...(from.owner ? [] : from.permissions)] : [],
    dataScope: from?.dataScope ?? "own",
    system: false,
    owner: false,
  };
}

/**
 * Settings: Security roles (spec Tier 1): the roles with their user counts beside the editor
 * for the selected role. New and copied roles stay unsaved until Save role.
 */
export function RolesPage() {
  const can = useCan();
  const { company } = useWorkspace();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [unsaved, setUnsaved] = useState<Role | null>(null);
  const data = useApiQuery(async (client) => {
    const [roles, users] = await Promise.all([client.list("roles"), client.list("users")]);
    return { roles, users };
  }, []);

  if (!can("settings.roles.view") && !can("settings.roles.manage")) return <NoAccess />;
  if (data.status !== "ready") return <Skeleton className="h-96" aria-label="Loading roles" />;
  const { roles, users } = data.data;
  const canManage = can("settings.roles.manage");
  const list = unsaved ? [...roles, unsaved] : roles;
  const selected = list.find((r) => r.id === selectedId) ?? list[0]!;
  const holders = (role: Role) => users.filter((u) => u.status !== "disabled" && u.roleIds.includes(role.id)).length;

  function startDraft(from?: Role) {
    const role = draftRole(company.id, from);
    setUnsaved(role);
    setSelectedId(role.id);
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
      <Panel
        title="Roles"
        actions={
          canManage ? (
            <Button variant="ghost" size="sm" onClick={() => startDraft()}>
              <Plus />
              New role
            </Button>
          ) : null
        }
        bodyClassName="p-2"
      >
        <ul className="flex flex-col gap-0.5">
          {list.map((role) => (
            <li key={role.id}>
              <button
                type="button"
                onClick={() => setSelectedId(role.id)}
                aria-current={role.id === selected.id ? "true" : undefined}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm",
                  role.id === selected.id ? "bg-brand-soft text-brand-ink font-medium" : "hover:bg-raised",
                )}
              >
                {role.owner ? <Lock aria-label="Locked" className="size-3.5" /> : null}
                <span className="flex-1 truncate">{role.name}</span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {role === unsaved ? "Unsaved" : `${holders(role)} ${holders(role) === 1 ? "user" : "users"}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      <RoleEditor
        // Remount when the saved role changes, so the editor starts from what was saved.
        key={JSON.stringify(selected)}
        role={selected}
        isNew={selected === unsaved}
        canManage={canManage}
        onCopy={(role) => startDraft(role)}
        onSaved={(role) => {
          if (unsaved?.id === role.id) setUnsaved(null);
          setSelectedId(role.id);
        }}
        onDeleted={() => setSelectedId(null)}
      />
    </div>
  );
}
