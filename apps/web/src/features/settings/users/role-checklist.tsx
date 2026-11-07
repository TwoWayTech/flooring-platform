"use client";

import { canAssignRole, type Role } from "@workspace/shared";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Label } from "@workspace/ui/components/label";
import { useWorkspace } from "@/components/workspace/workspace-context";

/** Why a role cannot be given by the viewer, or null when it can (blueprint rules 1 and 2). */
export function useAssignDenial() {
  const { access, company } = useWorkspace();
  return (role: Role) => {
    const denial = canAssignRole(access, role, company.ceiling, company.modules);
    if (denial === "owner_only") return "Only an Owner can make someone an Owner.";
    if (denial === "not_held") return "Includes permissions you do not hold.";
    return null;
  };
}

interface RoleChecklistProps {
  roles: Role[];
  selected: string[];
  /** Roles the person already has stay selectable even if the viewer could not grant them today. */
  current?: string[];
  onChange: (roleIds: string[]) => void;
}

/** Roles as checkboxes; roles the viewer may not assign are disabled with the reason. */
export function RoleChecklist({ roles, selected, current = [], onChange }: RoleChecklistProps) {
  const denial = useAssignDenial();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">Roles</legend>
      {roles.map((role) => {
        const reason = current.includes(role.id) ? null : denial(role);
        const id = `role-${role.id}`;
        return (
          <div key={role.id} className="flex items-start gap-2.5">
            <Checkbox
              id={id}
              checked={selected.includes(role.id)}
              disabled={!!reason}
              onCheckedChange={(on) => onChange(on ? [...selected, role.id] : selected.filter((r) => r !== role.id))}
              className="mt-0.5"
            />
            <Label htmlFor={id} className="flex flex-col items-start gap-0.5 font-normal">
              <span className="font-medium">{role.name}</span>
              <span className="text-muted-foreground text-xs">{reason ?? role.description}</span>
            </Label>
          </div>
        );
      })}
    </fieldset>
  );
}
