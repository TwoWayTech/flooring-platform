"use client";

import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { Toaster } from "@workspace/ui/components/sonner";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { GUIDE_FOOTPRINT_PX, usePresenterGuide } from "@/features/presenter/use-presenter-guide";

/** Toasts in the bottom right, moved aside while the presenter guide is open. */
function Toasts() {
  const [guideOpen] = usePresenterGuide();
  return <Toaster position="bottom-right" offset={guideOpen ? { right: GUIDE_FOOTPRINT_PX } : undefined} />;
}

/**
 * App-wide providers: light, dark and system themes (class on <html>), motion that respects
 * prefers-reduced-motion (CLAUDE.md rule 6), tooltips and toasts.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <MotionConfig reducedMotion="user">
        <TooltipProvider delayDuration={250}>
          {children}
          <Toasts />
        </TooltipProvider>
      </MotionConfig>
    </ThemeProvider>
  );
}
