"use client";

import { Check, ChevronsUpDown, Eye } from "lucide-react";
import { featureOn, SENSITIVE, type PermissionKey, type Role } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { useWorkspace } from "@/components/workspace/workspace-context";

/** "View as role" is for people who manage roles, so they can check what each role sees. */
export function useCanViewAs(): boolean {
  const { user, roles } = useWorkspace();
  const held = roles.filter((r) => user.roleIds.includes(r.id));
  return featureOn("shell.view-as") && held.some((r) => r.owner || r.permissions.includes("settings.roles.manage"));
}

/**
 * What the viewed-as role cannot see, phrased for the banner. Exported so each case is unit-tested
 * (view-as-banner.test.tsx).
 */
export function hiddenNote(role: Role): string {
  const hidden: string[] = [];
  const has = (key: PermissionKey) => role.permissions.includes(key);
  if (!has(SENSITIVE.productCost) && !has(SENSITIVE.margin)) hidden.push("Costs and margins are hidden.");
  else if (!has(SENSITIVE.margin)) hidden.push("Margins are hidden.");
  // Every margin a screen works out from cost also needs product cost (`seesMargin`), so a role
  // with the margin key alone sees no cost. The server's commission margin bases need the margin
  // key only (ADR 0048), so the note makes no claim about margins.
  else if (!has(SENSITIVE.productCost)) hidden.push("Costs are hidden.");
  if (!has(SENSITIVE.payRate) && has("hr.employee.view")) hidden.push("Pay rates are hidden.");
  return hidden.join(" ");
}

/** The sidebar control that switches "View as" to a role, or back to yourself. */
export function ViewAsSwitcher() {
  const { roles, viewAsRole, setViewAs } = useWorkspace();
  if (!useCanViewAs()) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="text-foreground/85 hover:bg-raised flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-sm">
        <Eye aria-hidden="true" className="text-muted-foreground size-4" />
        <span className="flex-1 truncate text-left">{viewAsRole ? `View as ${viewAsRole.name}` : "View as"}</span>
        <ChevronsUpDown aria-hidden="true" className="text-muted-foreground size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel>See the app as a role</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setViewAs(null)}>
          <span className="flex-1">Myself</span>
          {viewAsRole ? null : <Check aria-label="Selected" className="size-4" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {roles
          .filter((r) => !r.owner)
          .map((role) => (
            <DropdownMenuItem key={role.id} onSelect={() => setViewAs(role.id)}>
              <span className="flex-1">{role.name}</span>
              {viewAsRole?.id === role.id ? <Check aria-label="Selected" className="size-4" /> : null}
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Slim banner while viewing as a role (design brief: "Viewing as Sales. Costs and margins are hidden."). */
export function ViewAsBanner() {
  const { viewAsRole, setViewAs } = useWorkspace();
  if (!viewAsRole) return null;
  return (
    <div role="status" className="bg-warning/14 text-warning-ink flex items-center gap-3 rounded-md px-3 py-2 text-sm">
      <Eye aria-hidden="true" className="size-4 shrink-0" />
      <p className="flex-1">
        Viewing as {viewAsRole.name}. {hiddenNote(viewAsRole)}
      </p>
      <Button size="sm" variant="ghost" onClick={() => setViewAs(null)} className="text-warning-ink">
        Stop viewing as
      </Button>
    </div>
  );
}
