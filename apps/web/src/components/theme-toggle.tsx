"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@workspace/ui/components/button";

const NEXT = { light: "dark", dark: "system", system: "light" } as const;
const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;
const LABELS = { light: "Light theme", dark: "Dark theme", system: "System theme" } as const;

/** Cycles light, dark and system themes; the icon shows the current choice. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const current = (theme ?? "system") as keyof typeof NEXT;
  const Icon = ICONS[current] ?? Monitor;
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(NEXT[current] ?? "light")}
      aria-label={`${LABELS[current] ?? "Theme"}. Switch theme`}
      suppressHydrationWarning
    >
      <Icon />
    </Button>
  );
}
