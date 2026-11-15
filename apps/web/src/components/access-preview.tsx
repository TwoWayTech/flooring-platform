"use client";

import { useState } from "react";
import { Check, Eye, EyeOff, X } from "lucide-react";
import {
  dataScope,
  permissionDef,
  resolveAccess,
  PRODUCT_LABELS,
  SENSITIVE,
  type ModuleKey,
  type PermissionKey,
  type ProductKey,
  type RoleLike,
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
import { cn } from "@workspace/ui/lib/utils";
import { itemAllows } from "@/products";
import { pageList } from "@/products/pages";

const SENSITIVE_LABELS: Record<keyof typeof SENSITIVE, string> = {
  productCost: "Product cost",
  margin: "Sales margin",
  jobMargin: "Job margin",
  payRate: "Pay rate",
  creditLimit: "Credit limit",
};

const SCOPE_LABELS = { own: "Own records", branch: "Their branch", all: "Everything" } as const;

/** A role as the preview needs it: a company's own role, or a default template given an id. */
export type PreviewRole = RoleLike & { key: string; name: string };

interface AccessPreviewProps {
  /** The products whose pages are listed; a company with both products lists each one's pages. */
  products: readonly ProductKey[];
  roles: readonly PreviewRole[];
  /** People to preview; the platform console has none while a company's users need support access. */
  users: readonly User[];
  /** The ceiling and modules to preview under; the super-admin passes the draft plan before saving. */
  ceiling: PermissionKey[];
  modules: ModuleKey[];
}

/** One line of the preview: a page or action with a tick or a cross, never colour alone. */
function Allowed({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  const Icon = ok ? Check : X;
  return (
    <li className={cn("flex items-center gap-1.5 text-sm", !ok && "text-muted-foreground")}>
      <Icon aria-hidden="true" className={cn("size-3.5", ok ? "text-success-ink" : "")} />
      <span>
        {children}
        <span className="sr-only">{ok ? ", allowed" : ", not allowed"}</span>
      </span>
    </li>
  );
}

/**
 * Effective-access preview (blueprint "Company access", spec A3): pick a role or a user and see
 * every page, action and sensitive field they get. The super-admin uses it with the plan being
 * edited; a company admin uses it in Security roles with the plan as it is.
 */
export function AccessPreview({ products, roles, users, ceiling, modules }: AccessPreviewProps) {
  const [subject, setSubject] = useState(`role:${roles.find((r) => r.key === "sales")?.id ?? roles[0]?.id}`);
  const [kind, id] = subject.split(":") as ["role" | "user", string];
  const held =
    kind === "role"
      ? roles.filter((r) => r.id === id)
      : roles.filter((r) => users.find((u) => u.id === id)?.roleIds.includes(r.id));
  const access = resolveAccess(held, ceiling, modules);
  const people = users.filter((u) => u.status !== "disabled");
  const actions = [...access.permissions]
    .map((key) => permissionDef(key)!)
    .filter((def) => def.action !== "view" && def.action !== "view_sensitive");

  return (
    <div className="flex flex-col gap-5">
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
          {people.length > 0 ? (
            <SelectGroup>
              <SelectLabel>Users</SelectLabel>
              {people.map((u) => (
                <SelectItem key={u.id} value={`user:${u.id}`}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectGroup>
          ) : null}
        </SelectContent>
      </Select>
      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground text-xs">Permissions in effect</dt>
          <dd className="font-display text-xl font-semibold tabular-nums">{access.permissions.size}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">Data scope</dt>
          <dd className="text-sm font-medium">{SCOPE_LABELS[dataScope(held)]}</dd>
        </div>
      </dl>
      {products.map((product) => (
        <section key={product} aria-labelledby={`preview-pages-${product}`}>
          <h3 id={`preview-pages-${product}`} className="mb-2 text-sm font-semibold">
            {products.length > 1 ? `Pages in ${PRODUCT_LABELS[product]}` : "Pages"}
          </h3>
          <ul className="grid gap-1 sm:grid-cols-2">
            {pageList(product).map((page) => (
              <Allowed key={page.href} ok={itemAllows(page, access)}>
                {page.label}
              </Allowed>
            ))}
          </ul>
        </section>
      ))}
      <section aria-labelledby="preview-actions">
        <h3 id="preview-actions" className="mb-2 text-sm font-semibold">
          Actions ({actions.length})
        </h3>
        {actions.length === 0 ? (
          <p className="text-muted-foreground text-sm">Can only look, not change anything.</p>
        ) : (
          <ul className="grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-2">
            {actions.map((def) => (
              <Allowed key={def.key} ok>
                {def.label}
              </Allowed>
            ))}
          </ul>
        )}
      </section>
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
