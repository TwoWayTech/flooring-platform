"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import {
  dataScope,
  resolveAccess,
  SENSITIVE,
  type Company,
  type ModuleKey,
  type PermissionKey,
  type Role,
  type User,
} from "@workspace/shared";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { PRODUCTS, visibleItems } from "@/products";

const SENSITIVE_LABELS: Record<keyof typeof SENSITIVE, string> = {
  productCost: "Product cost",
  margin: "Sales margin",
  jobMargin: "Job margin",
  payRate: "Pay rate",
  creditLimit: "Credit limit",
};

interface AccessPreviewProps {
  company: Company;
  roles: Role[];
  users: User[];
  /** The draft ceiling and modules, so the preview shows the effect before saving. */
  ceiling: PermissionKey[];
  modules: ModuleKey[];
}

/**
 * Effective-access preview (blueprint "Company access"): pick a role or a user and see exactly
 * which menus and sensitive fields they get under the plan being edited.
 */
export function AccessPreview({ company, roles, users, ceiling, modules }: AccessPreviewProps) {
  const [subject, setSubject] = useState(`role:${roles.find((r) => r.key === "sales")?.id ?? roles[0]?.id}`);
  const [kind, id] = subject.split(":") as ["role" | "user", string];
  const held =
    kind === "role"
      ? roles.filter((r) => r.id === id)
      : roles.filter((r) => users.find((u) => u.id === id)?.roleIds.includes(r.id));
  const access = resolveAccess(held, ceiling, modules);
  const product = PRODUCTS[company.product];
  const menus = visibleItems([...product.menu, ...product.settings], access);

  return (
    <div className="flex flex-col gap-4">
      <Select value={subject} onValueChange={setSubject}>
        <SelectTrigger className="w-full sm:w-72" aria-label="Preview access for">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-80">
          <SelectGroup>
            <SelectLabel>Roles</SelectLabel>
            {roles.map((r) => (
              <SelectItem key={r.id} value={`role:${r.id}`}>
                {r.name}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>Users</SelectLabel>
            {users
              .filter((u) => u.status !== "disabled")
              .map((u) => (
                <SelectItem key={u.id} value={`user:${u.id}`}>
                  {u.name}
                </SelectItem>
              ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <dl className="grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground text-xs">Permissions in effect</dt>
          <dd className="font-display text-xl font-semibold tabular-nums">{access.permissions.size}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Data scope</dt>
          <dd className="text-sm font-medium">
            {{ own: "Own records", branch: "Their branch", all: "Everything" }[dataScope(held)]}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Menus</dt>
          <dd className="text-sm">{menus.map((m) => m.label).join(", ") || "None"}</dd>
        </div>
      </dl>
      <ul className="flex flex-wrap gap-2" aria-label="Sensitive fields">
        {(Object.keys(SENSITIVE) as (keyof typeof SENSITIVE)[]).map((field) => {
          const visible = access.permissions.has(SENSITIVE[field]);
          return (
            <li
              key={field}
              className={
                visible
                  ? "bg-success/12 text-success-ink inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs"
                  : "bg-raised text-muted-foreground inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs"
              }
            >
              {visible ? (
                <Eye aria-hidden="true" className="size-3.5" />
              ) : (
                <EyeOff aria-hidden="true" className="size-3.5" />
              )}
              {SENSITIVE_LABELS[field]} {visible ? "visible" : "hidden"}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
