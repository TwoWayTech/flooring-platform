"use client";

import { Menu, Presentation, Search } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Monogram } from "@workspace/ui/components/monogram";
import { ThemeToggle } from "@/components/theme-toggle";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { usePresenterGuide } from "@/features/presenter/use-presenter-guide";
import { Notifications } from "./notifications";
import { UserMenu } from "./user-menu";

interface TopBarProps {
  onOpenPalette: () => void;
  onOpenMenu: () => void;
}

/**
 * Top bar: menu and logo on phones, the command trigger, the presenter guide toggle,
 * notifications, theme and account.
 */
export function TopBar({ onOpenPalette, onOpenMenu }: TopBarProps) {
  const { settings } = useWorkspace();
  const { branding } = settings;
  const [guideOpen, setGuideOpen] = usePresenterGuide();
  return (
    <div className="flex h-14 items-center gap-2 px-4 lg:px-8">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenMenu} aria-label="Open menu">
        <Menu />
      </Button>
      <Monogram
        letters={branding.monogram}
        logoUrl={branding.logoDataUrl}
        name={branding.displayName}
        className="size-7 text-[10px] lg:hidden"
      />
      <button
        type="button"
        onClick={onOpenPalette}
        className="bg-surface border-hairline text-muted-foreground hover:border-foreground/30 ml-auto flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors sm:w-80 lg:mr-auto lg:ml-0"
        aria-keyshortcuts="Control+K Meta+K"
      >
        <Search aria-hidden="true" className="size-4" />
        <span className="sr-only sm:not-sr-only sm:flex-1 sm:text-left">Search or run a command</span>
        <kbd
          aria-hidden="true"
          className="bg-raised hidden rounded-sm px-1.5 py-0.5 font-sans text-xs font-medium sm:inline"
        >
          Ctrl K
        </kbd>
      </button>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Presenter guide"
          aria-pressed={guideOpen}
          className={guideOpen ? "bg-brand-soft text-brand-ink" : undefined}
          onClick={() => setGuideOpen(!guideOpen)}
        >
          <Presentation />
        </Button>
        <Notifications />
        <ThemeToggle />
        <UserMenu />
      </div>
    </div>
  );
}
