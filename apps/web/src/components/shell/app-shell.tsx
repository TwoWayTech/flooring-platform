"use client";

import { Suspense, useState, type ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@workspace/ui/components/sheet";
import { PageGate } from "@/components/page-gate";
import { PresenterGuide } from "@/features/presenter/presenter-guide";
import { CommandPalette } from "./command-palette";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { ViewAsBanner } from "./view-as";
import { featureOn } from "@workspace/shared";

/**
 * The app shell (design brief "Layout"): sidebar on the Limestone canvas from 1024 px, a drawer
 * below that, a skip link to the page, the top bar, the "View as" banner, the page and the presenter guide.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[252px_minmax(0,1fr)]">
      <a
        href="#main"
        className="bg-surface border-hairline focus:rounded-panel sr-only border focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-3 focus:py-2 focus:shadow-md"
      >
        Skip to main content
      </a>
      <aside className="hidden lg:sticky lg:top-0 lg:block lg:h-dvh">
        <Sidebar />
      </aside>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="bg-background w-[280px] p-0">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">Pages you can open</SheetDescription>
          <Sidebar onNavigate={() => setMenuOpen(false)} className="pt-12" />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-col">
        <TopBar onOpenPalette={() => setPaletteOpen(true)} onOpenMenu={() => setMenuOpen(true)} />
        <main
          id="main"
          tabIndex={-1}
          className="flex w-full max-w-[1400px] flex-1 flex-col gap-6 px-4 pt-2 pb-12 lg:px-8"
        >
          <ViewAsBanner />
          <PageGate>{children}</PageGate>
        </main>
      </div>
      {featureOn("shell.command-palette") ? <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} /> : null}
      {featureOn("shell.presenter-guide") ? (
        <Suspense fallback={null}>
          <PresenterGuide />
        </Suspense>
      ) : null}
    </div>
  );
}
