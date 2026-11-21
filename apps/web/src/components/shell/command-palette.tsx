"use client";

import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect } from "react";
import {
  Banknote,
  Building2,
  Eye,
  FilePlus2,
  LogOut,
  Moon,
  Presentation,
  RotateCcw,
  Scissors,
  UserPlus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { featureOn, type FeatureKey, type PermissionKey } from "@workspace/shared";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@workspace/ui/components/command";
import { useApiQuery } from "@/lib/api/use-api";
import { requestRecordPayment } from "@/lib/record-payment-request";
import { useSessionActions } from "@/lib/session/use-session-actions";
import { visibleItems } from "@/products";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { usePresenterGuide } from "@/features/presenter/use-presenter-guide";
import { featureInBuild } from "@/lib/demo-tools";
import { useGuardedRouter } from "@/lib/leave-guard";
import { resetDemo } from "./user-menu";
import { useCanViewAs } from "./view-as";

interface PaletteAction {
  label: string;
  icon: LucideIcon;
  /** Shown only with this permission; actions without one are open to everyone. */
  permission?: PermissionKey;
  /** Shown only while this feature is switched on. */
  feature?: FeatureKey;
  run: () => void;
}

/** Opens the palette on Ctrl K or Cmd K anywhere in the app. */
function useHotkey(onOpen: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpen]);
}

/**
 * The ⌘K palette (design brief "Components and patterns"): every page the viewer may open, plus
 * actions such as New quote, Record payment (on an invoice), Cut a roll, Invite user, the presenter
 * guide, View as role, Toggle theme and Sign out.
 */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  // Going somewhere from the palette asks first while a page has unsaved changes (click-through #56).
  const router = useGuardedRouter();
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const { product, access, roles, setViewAs, viewAsRole, company, session } = useWorkspace();
  const companies = useApiQuery((client) => client.listCompanies(), []);
  const otherCompanies = (companies.data ?? []).filter((c) => c.product === session.product && c.id !== company.id);
  const { signOut, switchCompany } = useSessionActions();
  const [guideOpen, setGuideOpen] = usePresenterGuide();
  useHotkey(() => onOpenChange(true));

  const run = (action: () => void) => {
    onOpenChange(false);
    action();
  };
  const pages = visibleItems([...product.menu, ...product.settings], access);
  const allActions: PaletteAction[] = [
    {
      label: "New quote",
      icon: FilePlus2,
      permission: "sales.quote.create",
      feature: "sales.quotes",
      run: () => router.push("/sales/quotes/new"),
    },
    ...(pathname.startsWith("/sales/invoices/")
      ? [
          {
            label: "Record payment",
            icon: Banknote,
            permission: "sales.payment.record" as const,
            feature: "sales.payments" as const,
            run: requestRecordPayment,
          },
        ]
      : []),
    {
      label: "Cut a roll",
      icon: Scissors,
      permission: "inventory.roll.cut",
      feature: "inventory.rolls",
      run: () => router.push("/inventory?view=rolls"),
    },
    {
      label: "Invite user",
      icon: UserPlus,
      permission: "settings.users.manage",
      feature: "settings.users",
      run: () => router.push("/settings/users?invite=1"),
    },
    {
      label: guideOpen ? "Hide presenter guide" : "Show presenter guide",
      icon: Presentation,
      feature: "shell.presenter-guide",
      run: () => setGuideOpen(!guideOpen),
    },
    { label: "Toggle theme", icon: Moon, run: () => setTheme(resolvedTheme === "dark" ? "light" : "dark") },
    { label: "Reset demo data", icon: RotateCcw, feature: "demo.reset", run: () => void resetDemo() },
    { label: "Sign out", icon: LogOut, run: () => void signOut() },
  ];
  const actions = allActions.filter(
    (a) => (!a.permission || access.permissions.has(a.permission)) && (!a.feature || featureInBuild(a.feature)),
  );
  const canViewAs = useCanViewAs();

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search or run a command"
      description="Go to a page or run an action"
    >
      <Command>
        <CommandInput placeholder="Search or run a command" />
        <CommandList>
          <CommandEmpty>Nothing matches. Try a page name or an action such as New quote.</CommandEmpty>
          <CommandGroup heading="Go to">
            {pages.map((page) => (
              <CommandItem
                key={page.href}
                value={`Go to ${page.label}`}
                onSelect={() => run(() => router.push(page.href))}
              >
                <page.icon />
                {page.label}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Actions">
            {actions.map((action) => (
              <CommandItem key={action.label} onSelect={() => run(action.run)}>
                <action.icon />
                {action.label}
              </CommandItem>
            ))}
          </CommandGroup>
          {otherCompanies.length > 0 && featureOn("shell.company-switcher") ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="Switch company">
                {otherCompanies.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`Switch to ${c.name}`}
                    onSelect={() => run(() => void switchCompany(c, session))}
                  >
                    <Building2 />
                    Switch to {c.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : null}
          {canViewAs ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="View as role">
                {viewAsRole ? (
                  <CommandItem onSelect={() => run(() => setViewAs(null))}>
                    <Eye />
                    Stop viewing as {viewAsRole.name}
                  </CommandItem>
                ) : null}
                {roles
                  .filter((r) => !r.owner && r.id !== viewAsRole?.id)
                  .map((role) => (
                    <CommandItem
                      key={role.id}
                      value={`View as ${role.name}`}
                      onSelect={() => run(() => setViewAs(role.id))}
                    >
                      <Eye />
                      View as {role.name}
                    </CommandItem>
                  ))}
              </CommandGroup>
            </>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
