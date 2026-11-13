"use client";

import { useState } from "react";
import { formatDistanceStrict, parseISO } from "date-fns";
import { CircleCheck, CircleDashed, Ban, MoreHorizontal, ShieldCheck, ShieldOff, UserPlus } from "lucide-react";
import { toast } from "sonner";
import type { User } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Panel } from "@workspace/ui/components/panel";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { QueryFallback } from "@/components/query-fallback";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { NoAccess } from "@/components/no-access";
import { StepUpDialog } from "@/components/step-up-dialog";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { ChangeRolesDialog } from "./change-roles-dialog";
import { InviteDialog } from "./invite-dialog";

const STATUS = {
  active: { tone: "success", icon: CircleCheck, label: "Active" },
  invited: { tone: "brand", icon: CircleDashed, label: "Invited" },
  disabled: { tone: "neutral", icon: Ban, label: "Disabled" },
} as const;

/** Seats used against the plan's limit; disabled users free their seat (spec "Settings: Users"). */
function SeatMeter({ used, limit }: { used: number; limit: number }) {
  const full = used >= limit;
  return (
    <div className="flex min-w-48 flex-col gap-1.5">
      <p className="text-sm">
        <span className="font-semibold tabular-nums">{used}</span> of <span className="tabular-nums">{limit}</span>{" "}
        seats used
      </p>
      <span className="bg-raised h-1.5 overflow-hidden rounded-full" aria-hidden="true">
        <span
          className={full ? "bg-warning block h-full" : "bg-brand block h-full"}
          style={{ width: `${Math.min(100, (used / limit) * 100)}%` }}
        />
      </span>
    </div>
  );
}

/**
 * Settings: Users (spec Tier 1): status, roles, branch, MFA, last login and seats; invite,
 * disable or enable, reset MFA and change roles. Users are disabled, never deleted.
 */
export function UsersPage() {
  const can = useCan();
  const { company } = useWorkspace();
  const [inviting, setInviting] = useState(false);
  const [editingRoles, setEditingRoles] = useState<User | null>(null);
  const [resettingMfa, setResettingMfa] = useState<User | null>(null);
  // Disabling or enabling someone changes whether they can sign in, so it asks for a step-up code.
  const [changingStatus, setChangingStatus] = useState<{ user: User; status: User["status"] } | null>(null);
  const data = useApiQuery(async (client) => {
    const [users, roles] = await Promise.all([client.listSettingsUsers(), client.listSettingsRoles()]);
    return { users, roles };
  }, []);

  if (!can("settings.users.view") && !can("settings.users.manage")) return <NoAccess />;
  if (data.status !== "ready") return <QueryFallback query={data} className="h-96" label="Loading users" />;
  const { users, roles } = data.data;
  const manage = can("settings.users.manage");
  const seatsUsed = users.filter((u) => u.status !== "disabled").length;
  const now = new Date();

  async function setStatus(user: User, status: User["status"]) {
    await api.updateUser(user.id, { status });
    toast.success(`${user.name} ${status === "disabled" ? "disabled" : "enabled"}`);
    setChangingStatus(null);
  }

  const columns: ColumnSpec<User>[] = [
    {
      id: "name",
      header: "Name",
      value: (u) => u.name,
      cell: (u) => (
        <span className="flex flex-col">
          <span className="font-medium">{u.name}</span>
          <span className="text-muted-foreground text-xs">{u.email}</span>
        </span>
      ),
    },
    { id: "title", header: "Title", value: (u) => u.title, hidden: true },
    {
      id: "roles",
      header: "Roles",
      value: (u) =>
        roles
          .filter((r) => u.roleIds.includes(r.id))
          .map((r) => r.name)
          .join(", "),
    },
    { id: "branch", header: "Branch", value: (u) => company.branches.find((b) => b.id === u.branchId)?.name ?? "" },
    {
      id: "status",
      header: "Status",
      value: (u) => STATUS[u.status].label,
      cell: (u) => <StatusPill {...STATUS[u.status]} />,
    },
    {
      id: "mfa",
      header: "MFA",
      value: (u) => (u.mfaEnrolled ? "On" : "Off"),
      cell: (u) =>
        u.mfaEnrolled ? (
          <span className="inline-flex items-center gap-1">
            <ShieldCheck aria-hidden="true" className="text-success-ink size-4" />
            On
          </span>
        ) : (
          <span className="text-muted-foreground inline-flex items-center gap-1">
            <ShieldOff aria-hidden="true" className="size-4" />
            Off
          </span>
        ),
    },
    {
      id: "lastLogin",
      header: "Last login",
      value: (u) => u.lastLoginAt,
      cell: (u) =>
        u.lastLoginAt ? (
          `${formatDistanceStrict(parseISO(u.lastLoginAt), now)} ago`
        ) : (
          <span className="text-muted-foreground">Never</span>
        ),
    },
    ...(manage
      ? [
          {
            id: "actions",
            header: "Actions",
            visualOnly: true,
            value: () => null,
            cell: (u: User) => (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Actions for ${u.name}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setEditingRoles(u)}>Change roles</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setResettingMfa(u)} disabled={!u.mfaEnrolled}>
                    Reset MFA
                  </DropdownMenuItem>
                  {u.status === "disabled" ? (
                    <DropdownMenuItem onSelect={() => setChangingStatus({ user: u, status: "active" })}>
                      Enable user
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={() => setChangingStatus({ user: u, status: "disabled" })}>
                      Disable user
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <Panel bodyClassName="flex flex-wrap items-center justify-between gap-4">
        <SeatMeter used={seatsUsed} limit={company.userLimit} />
        {manage ? (
          <Button onClick={() => setInviting(true)}>
            <UserPlus />
            Invite user
          </Button>
        ) : null}
      </Panel>
      <DataTable
        id="settings-users"
        rows={users}
        columns={columns}
        getRowId={(u) => u.id}
        searchPlaceholder="Search users"
        csvName="users"
        initialSort={{ id: "name", desc: false }}
        empty={{ message: "No users yet." }}
      />
      <InviteDialog open={inviting} onOpenChange={setInviting} roles={roles} branches={company.branches} />
      {editingRoles ? (
        <ChangeRolesDialog user={editingRoles} roles={roles} onClose={() => setEditingRoles(null)} />
      ) : null}
      <StepUpDialog
        open={!!changingStatus}
        action={
          changingStatus
            ? `${changingStatus.status === "disabled" ? "Disabling" : "Enabling"} ${changingStatus.user.name}`
            : ""
        }
        onOpenChange={(open) => !open && setChangingStatus(null)}
        onConfirm={() => setStatus(changingStatus!.user, changingStatus!.status)}
      />
      <StepUpDialog
        open={!!resettingMfa}
        action={resettingMfa ? `Resetting MFA for ${resettingMfa.name}` : ""}
        onOpenChange={(open) => !open && setResettingMfa(null)}
        onConfirm={async () => {
          await api.updateUser(resettingMfa!.id, { mfaEnrolled: false });
          toast.success(`MFA reset for ${resettingMfa!.name}. They enroll again at next sign-in.`);
          setResettingMfa(null);
        }}
      />
    </>
  );
}
