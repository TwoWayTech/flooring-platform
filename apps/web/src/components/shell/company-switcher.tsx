"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { Company } from "@workspace/shared";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { FloorPattern } from "@workspace/ui/components/floor-pattern";
import { Monogram } from "@workspace/ui/components/monogram";
import { useApiQuery } from "@/lib/api/use-api";
import { useSessionActions } from "@/lib/session/use-session-actions";
import { useWorkspace } from "@/components/workspace/workspace-context";

/** The pattern swatch with the company logo set into it: the sidebar's one strong color (design plan). */
function CompanyMark() {
  const { settings } = useWorkspace();
  const { branding } = settings;
  return (
    <span aria-hidden="true" className="relative size-11 shrink-0">
      <FloorPattern
        pattern={branding.pattern}
        width={88}
        height={88}
        unit={8}
        strength="strong"
        className="rounded-panel size-full overflow-hidden"
      />
      <Monogram
        letters={branding.monogram}
        logoUrl={branding.logoDataUrl}
        name={branding.displayName}
        className="ring-background absolute -right-1.5 -bottom-1.5 size-6 rounded-sm text-[9px] ring-2"
      />
    </span>
  );
}

/**
 * Switches the presenter to the same persona in another company of this product. The new
 * session reloads the shell with that company's logo, name, colors and pattern (spec "App shell").
 */
export function CompanySwitcher() {
  const { company, settings, session, product } = useWorkspace();
  const [switching, setSwitching] = useState(false);
  const { switchCompany } = useSessionActions();
  const companies = useApiQuery((client) => client.listCompanies(), []);
  const choices = (companies.data ?? []).filter((c) => c.product === session.product);

  async function switchTo(target: Company) {
    if (target.id === company.id) return;
    setSwitching(true);
    try {
      await switchCompany(target, session);
      setSwitching(false);
    } catch (error) {
      setSwitching(false);
      toast.error(error instanceof Error ? error.message : "Could not switch company.");
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={switching}
        className="hover:bg-raised flex w-full items-center gap-3 rounded-md p-1.5 text-left transition-colors"
      >
        <CompanyMark />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm leading-tight font-semibold">{settings.branding.displayName}</span>
          <span className="text-muted-foreground block truncate text-xs">{product.name}</span>
          <span className="sr-only">, switch company</span>
        </span>
        <ChevronsUpDown aria-hidden="true" className="text-muted-foreground size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Switch company</DropdownMenuLabel>
        {choices.map((c) => (
          <DropdownMenuItem key={c.id} onSelect={() => void switchTo(c)} className="gap-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{c.name}</span>
              <span className="text-muted-foreground block text-xs">
                {c.city}, {c.state}
              </span>
            </span>
            {c.id === company.id ? <Check aria-label="Current company" className="size-4" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
