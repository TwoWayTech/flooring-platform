"use client";

import { Lock } from "lucide-react";
import {
  actionLabel,
  visibleModules,
  PERMISSIONS,
  PRODUCT_MODULES,
  type ModuleKey,
  type PermissionAction,
  type PermissionDef,
  type PermissionKey,
  type ProductKey,
} from "@workspace/shared";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { ScrollRegion } from "@/components/scroll-region";

/** Why a permission cannot be ticked by this viewer, or null when it can. */
export type CellLock = "plan" | "module" | "not_held" | "owner" | null;

const LOCK_TEXT: Record<Exclude<CellLock, null>, string> = {
  plan: "Not included in your plan",
  module: "Module not switched on for this company",
  not_held: "You can only grant permissions you hold",
  owner: "The Owner role always holds everything in your plan",
};

interface Row {
  resource: string;
  cells: Partial<Record<PermissionAction, PermissionDef>>;
}

/** The catalog for one module as matrix rows: resource by action (blueprint "Security roles"). */
function moduleRows(module: ModuleKey): { actions: PermissionAction[]; rows: Row[] } {
  const defs = PERMISSIONS.filter((p) => p.module === module);
  const actions = [...new Set(defs.map((d) => d.action))];
  const rows: Row[] = [];
  for (const def of defs) {
    let row = rows.find((r) => r.resource === def.resource);
    if (!row) rows.push((row = { resource: def.resource, cells: {} }));
    row.cells[def.action] = def;
  }
  return { actions, rows };
}

interface PermissionMatrixProps {
  product: ProductKey;
  granted: readonly PermissionKey[];
  lockOf: (key: PermissionKey) => CellLock;
  onToggle: (key: PermissionKey, on: boolean) => void;
}

/**
 * The permission matrix by module, resource and action. A tick outside the plan stays visible
 * but inactive (blueprint rule 3), so restoring the ceiling restores the access.
 */
export function PermissionMatrix({ product, granted, lockOf, onToggle }: PermissionMatrixProps) {
  const modules = visibleModules().filter((m) => PRODUCT_MODULES[product].includes(m.key));
  return (
    <div className="flex flex-col gap-6">
      {modules.map((module) => {
        const { actions, rows } = moduleRows(module.key);
        return (
          <section key={module.key} aria-labelledby={`module-${module.key}`} className="flex flex-col gap-2">
            <div>
              <h3 id={`module-${module.key}`} className="text-sm font-semibold">
                {module.label}
              </h3>
              <p className="text-muted-foreground text-xs">{module.description}</p>
            </div>
            <ScrollRegion label={`${module.label} permissions`} className="border-hairline rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-raised text-muted-foreground text-xs">
                  <tr>
                    <th scope="col" className="h-9 px-3 text-left font-medium">
                      Resource
                    </th>
                    {actions.map((a) => (
                      <th key={a} scope="col" className="px-2 text-center font-medium whitespace-nowrap">
                        {actionLabel(a)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.resource} className="border-hairline border-t">
                      <th scope="row" className="h-9 px-3 text-left font-normal whitespace-nowrap">
                        {row.resource}
                      </th>
                      {actions.map((action) => {
                        const def = row.cells[action];
                        if (!def) return <td key={action} />;
                        const lock = lockOf(def.key);
                        const checked = granted.includes(def.key);
                        const inactive = checked && (lock === "plan" || lock === "module");
                        const box = (
                          <Checkbox
                            aria-label={`${def.label}${lock ? `, ${LOCK_TEXT[lock]}` : ""}`}
                            checked={checked}
                            disabled={!!lock}
                            onCheckedChange={(on) => onToggle(def.key, on === true)}
                            className={cn(inactive && "opacity-40")}
                          />
                        );
                        return (
                          <td key={action} className="px-2 text-center">
                            {lock && lock !== "owner" ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex items-center gap-0.5" tabIndex={0}>
                                    {box}
                                    {lock === "plan" ? (
                                      <Lock aria-hidden="true" className="text-muted-foreground size-3" />
                                    ) : null}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>{LOCK_TEXT[lock]}</TooltipContent>
                              </Tooltip>
                            ) : (
                              box
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          </section>
        );
      })}
    </div>
  );
}
