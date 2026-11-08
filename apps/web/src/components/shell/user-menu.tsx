"use client";

import { LogOut, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { api } from "@/lib/api";
import { useSessionActions } from "@/lib/session/use-session-actions";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { featureOn } from "@workspace/shared";

/** Initials for the avatar: first letters of the first and last name. */
export function initials(name: string): string {
  const parts = name.split(" ").filter(Boolean);
  return `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
}

/** Restores the generated fixtures for every company, after the presenter's edits. */
export async function resetDemo() {
  await api.resetDemo();
  toast.success("Demo data reset");
}

/** The avatar menu: who is signed in, reset demo data, sign out. */
export function UserMenu() {
  const { user, roles } = useWorkspace();
  const { signOut } = useSessionActions();
  const roleNames = roles
    .filter((r) => user.roleIds.includes(r.id))
    .map((r) => r.name)
    .join(", ");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="bg-raised border-hairline grid size-8 place-items-center rounded-full border text-xs font-semibold">
        <span aria-hidden="true">{initials(user.name)}</span>
        <span className="sr-only">Account: {user.name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-foreground text-sm font-semibold">{user.name}</span>
          <span className="text-muted-foreground text-xs font-normal">
            {user.title}, {roleNames}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {featureOn("demo.reset") ? (
          <DropdownMenuItem onSelect={() => void resetDemo()}>
            <RotateCcw />
            Reset demo data
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
