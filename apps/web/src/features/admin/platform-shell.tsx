"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { LogOut, ShieldCheck } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { useSessionActions } from "@/lib/session/use-session-actions";

/** The platform admin's frame: no company branding, just the platform and its companies. */
export function PlatformShell({ children }: { children: ReactNode }) {
  const { signOut } = useSessionActions();
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
      <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 px-4 py-6 lg:px-8">{children}</main>
    </div>
  );
}
