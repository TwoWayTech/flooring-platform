"use client";

import { Lock } from "lucide-react";
import {
  actionLabel,
  visibleModules,
  PERMISSIONS,
  type ModuleKey,
  type PermissionAction,
  type PermissionDef,
  type PermissionKey,
} from "@workspace/shared";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { ScrollRegion } from "@/components/scroll-region";

/**
 * Why a permission cannot be changed by this viewer, or null when it can. The role editor uses the
 * first four; the platform console's access page uses `protected` (a key every company keeps) and
 * `read_only` (a platform role that may not change access; docs/specs/platform-admin.md, part 3).
 */
export type CellLock = "plan" | "module" | "not_held" | "owner" | "protected" | "read_only" | null;

const LOCK_TEXT: Record<Exclude<CellLock, null>, string> = {
  plan: "Not included in your plan",
  module: "Module not switched on for this company",
  not_held: "You can only grant permissions you hold",
  owner: "The Owner role always holds everything in your plan",
  protected: "Every company keeps this permission",
  read_only: "Only the platform owner role can change this",
};

/**
 * Locks that give their reason in the box's name only, with no tooltip: they cover the whole
 * matrix, so a tooltip on each box would add a tab stop per permission.
 */
const PLAIN_LOCKS: ReadonlySet<CellLock> = new Set(["owner", "read_only"]);

/**
 * A box's accessible name: always the permission's label, then why it is locked, if it is. The
 * locked box itself is the tooltip's focus stop (aria-disabled rather than disabled, so it can take
 * focus and hover), so no unnamed wrapper is ever announced in its place (click-through #53).
 */
export function cellName(def: Pick<PermissionDef, "label">, lock: CellLock): string {
  return lock ? `${def.label}, ${LOCK_TEXT[lock]}` : def.label;
}

/**
 * What a box does when clicked or toggled with Space: a locked one does nothing. An aria-disabled
 * box still receives clicks and keys, so the lock, not the browser, must keep it from changing.
 */
export function boxToggle(
  key: PermissionKey,
  lock: CellLock,
  onToggle: (key: PermissionKey, on: boolean) => void,
): (on: boolean | "indeterminate") => void {
  return (on) => {
    if (lock === null) onToggle(key, on === true);
  };
}

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
  /**
   * The modules whose permissions are shown; hidden ones are left out (rule 18). Security roles
   * passes its product's modules, the platform console those of all of a company's products.
   */
  modules: readonly ModuleKey[];
  granted: readonly PermissionKey[];
  lockOf: (key: PermissionKey) => CellLock;
  onToggle: (key: PermissionKey, on: boolean) => void;
}

/**
 * The permission matrix by module, resource and action. A tick outside the plan stays visible
 * but inactive (blueprint rule 3), so restoring the ceiling restores the access.
 */
export function PermissionMatrix({ modules: included, granted, lockOf, onToggle }: PermissionMatrixProps) {
  const modules = visibleModules().filter((m) => included.includes(m.key));
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
            {/* The box scrolls both ways, so the action headers and the resource names stay in view (#53). */}
            <ScrollRegion
              label={`${module.label} permissions`}
              className="border-hairline max-h-[70vh] overflow-y-auto rounded-md border"
            >
              <table className="w-full border-separate border-spacing-0 text-sm">
                <thead className="text-muted-foreground text-xs">
                  <tr>
                    <th scope="col" className="bg-raised sticky top-0 left-0 z-20 h-9 px-3 text-left font-medium">
                      Resource
                    </th>
                    {actions.map((a) => (
                      <th
                        key={a}
                        scope="col"
                        className="bg-raised sticky top-0 z-10 px-2 text-center font-medium whitespace-nowrap"
                      >
                        {actionLabel(a)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.resource} className="*:border-hairline *:border-t">
                      <th
                        scope="row"
                        className="bg-surface sticky left-0 z-[1] h-9 px-3 text-left font-normal whitespace-nowrap"
                      >
                        {row.resource}
                      </th>
                      {actions.map((action) => {
                        const def = row.cells[action];
                        if (!def) return <td key={action} />;
                        const lock = lockOf(def.key);
                        const checked = granted.includes(def.key);
                        const tooltip = lock !== null && !PLAIN_LOCKS.has(lock);
                        return (
                          <td key={action} className="px-2 text-center">
                            {tooltip ? (
                              <span className="inline-flex items-center gap-0.5">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Checkbox
                                      aria-label={cellName(def, lock)}
                                      aria-disabled="true"
                                      checked={checked}
                                      onCheckedChange={boxToggle(def.key, lock, onToggle)}
                                      className={cn(
                                        "cursor-not-allowed opacity-50",
                                        checked && (lock === "plan" || lock === "module") && "opacity-40",
                                      )}
                                    />
                                  </TooltipTrigger>
                                  <TooltipContent>{LOCK_TEXT[lock]}</TooltipContent>
                                </Tooltip>
                                {lock === "plan" ? (
                                  <Lock aria-hidden="true" className="text-muted-foreground size-3" />
                                ) : null}
                              </span>
                            ) : (
                              <Checkbox
                                aria-label={cellName(def, lock)}
                                checked={checked}
                                disabled={lock !== null}
                                onCheckedChange={boxToggle(def.key, lock, onToggle)}
                              />
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
