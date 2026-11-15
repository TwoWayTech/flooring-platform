"use client";

import Link from "next/link";
import { useLayoutEffect, type ReactNode } from "react";
import { LogOut, ShieldCheck } from "lucide-react";
import type { PlatformAdminRole } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { api } from "@/lib/api";
import { useSessionActions } from "@/lib/session/use-session-actions";
import { PlatformNav } from "./platform-nav";
import { PlatformRoleProvider } from "./platform-role";

/**
 * The platform admin's frame: no company branding, just the platform, its sections (Companies and
 * the audit log) and its companies. `role` is the admin's role from `GET /platform/me`, handed to
 * the pages below so they offer only what that role may do (docs/specs/platform-admin.md, part 3).
 */
export function PlatformShell({ role, children }: { role: PlatformAdminRole; children: ReactNode }) {
  const { signOut } = useSessionActions();
  // Before any page below reads data, the platform admin acts as the platform rather than as a
  // company user left open by an earlier sign-in in this tab (spec G1). Layout effects run first.
  useLayoutEffect(() => api.closeCompany(), []);
  return (
    <div className="min-h-dvh">
      <header className="border-hairline flex h-14 items-center gap-3 border-b px-4 lg:px-8">
        <Link href="/admin" className="flex items-center gap-2 font-semibold">
          <ShieldCheck aria-hidden="true" className="text-brand-ink size-5" />
          Platform admin
        </Link>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            <LogOut />
            Sign out
          </Button>
        </div>
      </header>
      <PlatformNav />
      <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 py-6 lg:px-8">
        <PlatformRoleProvider role={role}>{children}</PlatformRoleProvider>
      </main>
    </div>
  );
}
