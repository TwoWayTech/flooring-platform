"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@workspace/ui/components/button";
import { useHydrated } from "@/lib/use-hydrated";

const NEXT = { light: "dark", dark: "system", system: "light" } as const;
const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;
const LABELS = { light: "Light theme", dark: "Dark theme", system: "System theme" } as const;

/**
 * Cycles light, dark and system themes; the icon shows the current choice. The saved choice is
 * only known in the browser, so the server and hydration render "system" first.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const hydrated = useHydrated();
  const current = (hydrated && theme ? theme : "system") as keyof typeof NEXT;
  const Icon = ICONS[current] ?? Monitor;
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(NEXT[current] ?? "light")}
      aria-label={`${LABELS[current] ?? "Theme"}. Switch theme`}
    >
      <Icon />
    </Button>
  );
}
