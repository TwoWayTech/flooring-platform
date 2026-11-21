"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, RotateCcw, ShieldCheck, UserRound } from "lucide-react";
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
import { isDemoMode } from "@/lib/data-source";
import { featureOn } from "@workspace/shared";
import { featureInBuild } from "@/lib/demo-tools";
import { ProfileDialog } from "./profile-dialog";

/** Initials for the avatar: first letters of the first and last name. */
export function initials(name: string): string {
  const parts = name.split(" ").filter(Boolean);
  return `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
}

/**
 * The account menu's second line: the job title, then the roles, each name once. A title that is
 * also a role's name, such as Owner, is not repeated (click-through #70).
 */
export function accountRoleLine(title: string, roleNames: readonly string[]): string {
  const parts = [title, ...roleNames].map((part) => part.trim()).filter(Boolean);
  const first = (part: string) => parts.findIndex((other) => other.toLowerCase() === part.toLowerCase());
  return parts.filter((part, i) => first(part) === i).join(", ");
}

/** Restores the generated fixtures for every company, after the presenter's edits. */
export async function resetDemo() {
  await api.resetDemo();
  toast.success("Demo data reset");
}

/** The avatar menu: who is signed in, their profile, sign-in and security, reset demo data, sign out. */
export function UserMenu() {
  const { user, roles, product } = useWorkspace();
  const [profileOpen, setProfileOpen] = useState(false);
  // There is no PATCH /me on the API yet, and the dialog reads and saves DemoStore's warehouses, so
  // Your profile is demo only; the API's default warehouse comes through GET /company (ADR 0051, D8).
  const hasWarehouses = featureOn("inventory.locations") && product.key === "flooring" && isDemoMode();
  const { signOut } = useSessionActions();
  const router = useRouter();
  const roleLine = accountRoleLine(
    user.title,
    roles.filter((r) => user.roleIds.includes(r.id)).map((r) => r.name),
  );
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="bg-raised border-hairline grid size-8 place-items-center rounded-full border text-xs font-semibold">
          <span aria-hidden="true">{initials(user.name)}</span>
          <span className="sr-only">Account: {user.name}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span className="text-foreground text-sm font-semibold">{user.name}</span>
            <span className="text-muted-foreground text-xs font-normal">{roleLine}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {hasWarehouses ? (
            <DropdownMenuItem onSelect={() => setProfileOpen(true)}>
              <UserRound />
              Your profile
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => router.push("/account/security")}>
            <ShieldCheck />
            Sign-in and security
          </DropdownMenuItem>
          {featureInBuild("demo.reset") ? (
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
      {profileOpen ? <ProfileDialog open onOpenChange={setProfileOpen} /> : null}
    </>
  );
}
