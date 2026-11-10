"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import {
  visibleModules,
  PRODUCT_LABELS,
  PRODUCT_MODULES,
  type Company,
  type CompanyId,
  type ModuleKey,
  type PermissionKey,
  type Role,
  type User,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Panel } from "@workspace/ui/components/panel";
import { Switch } from "@workspace/ui/components/switch";
import { QueryFallback } from "@/components/query-fallback";
import { Field } from "@/components/field";
import { PermissionMatrix } from "@/features/settings/roles/permission-matrix";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { AccessPreview } from "@/components/access-preview";
import { BackToCompanies, CompanyAdminNav } from "./company-admin-nav";

interface Draft {
  modules: ModuleKey[];
  ceiling: PermissionKey[];
  userLimit: number;
  branchLimit: number;
}

function AccessEditor({ company, roles, users }: { company: Company; roles: Role[]; users: User[] }) {
  const [draft, setDraft] = useState<Draft>({
    modules: company.modules,
    ceiling: company.ceiling,
    userLimit: company.userLimit,
    branchLimit: company.branchLimit,
  });
  const dirty =
    JSON.stringify(draft) !==
    JSON.stringify({
      modules: company.modules,
      ceiling: company.ceiling,
      userLimit: company.userLimit,
      branchLimit: company.branchLimit,
    });
  const offered = visibleModules().filter((m) => PRODUCT_MODULES[company.product].includes(m.key));

  async function save() {
    await api.updateCompanyAccess(company.id, draft);
    toast.success(`Access saved for ${company.name}. It applies at once.`);
  }

  return (
    <>
      <PageHeader
        title={company.name}
        description={`${PRODUCT_LABELS[company.product]}, ${company.plan}`}
        actions={
          <Button onClick={() => void save()} disabled={!dirty}>
            <Save />
            Save access
          </Button>
        }
      />
      <CompanyAdminNav companyId={company.id} />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Panel title="Modules and limits" bodyClassName="flex flex-col gap-4">
          <ul className="divide-hairline divide-y">
            {offered.map((m) => (
              <li key={m.key} className="flex items-center justify-between gap-4 py-2.5">
                <span>
                  <span className="block text-sm font-medium">{m.label}</span>
                  <span className="text-muted-foreground text-xs">{m.description}</span>
                </span>
                <Switch
                  aria-label={`${m.label} module`}
                  checked={draft.modules.includes(m.key)}
                  disabled={m.key === "platform"}
                  onCheckedChange={(on) =>
                    setDraft({
                      ...draft,
                      modules: on ? [...draft.modules, m.key] : draft.modules.filter((k) => k !== m.key),
                    })
                  }
                />
              </li>
            ))}
          </ul>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="limit-users" label="User limit">
              <Input
                id="limit-users"
                type="number"
                min={1}
                value={draft.userLimit}
                onChange={(e) => setDraft({ ...draft, userLimit: Math.max(1, Number(e.target.value)) })}
              />
            </Field>
            <Field id="limit-branches" label="Branch limit">
              <Input
                id="limit-branches"
                type="number"
                min={1}
                value={draft.branchLimit}
                onChange={(e) => setDraft({ ...draft, branchLimit: Math.max(1, Number(e.target.value)) })}
              />
            </Field>
          </div>
        </Panel>
        <Panel title="Effective access preview">
          <AccessPreview
            company={company}
            roles={roles}
            users={users}
            ceiling={draft.ceiling}
            modules={draft.modules}
          />
        </Panel>
      </div>
      <Panel title="Permission ceiling">
        <p className="text-muted-foreground mb-4 max-w-prose text-sm">
          The permissions this company&apos;s admins may hand out. Unticking one removes it from every role at once;
          roles keep the tick as inactive, so ticking it again restores access.
        </p>
        <PermissionMatrix
          product={company.product}
          granted={draft.ceiling}
          lockOf={() => null}
          onToggle={(key, on) =>
            setDraft({ ...draft, ceiling: on ? [...draft.ceiling, key] : draft.ceiling.filter((k) => k !== key) })
          }
        />
      </Panel>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Panel title="Roles, read only" bodyClassName="p-0">
          <ul className="divide-hairline divide-y text-sm">
            {roles.map((r) => (
              <li key={r.id} className="flex justify-between gap-4 px-4 py-2.5">
                <span className="font-medium">{r.name}</span>
                <span className="text-muted-foreground">{r.permissions.length} permissions</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Users, read only" bodyClassName="p-0">
          <ul className="divide-hairline divide-y text-sm">
            {users.map((u) => (
              <li key={u.id} className="flex justify-between gap-4 px-4 py-2.5">
                <span className="font-medium">{u.name}</span>
                <span className="text-muted-foreground">
                  {roles
                    .filter((r) => u.roleIds.includes(r.id))
                    .map((r) => r.name)
                    .join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}

/** Super-admin: company access (spec "Super-admin"): products, modules, ceiling, limits, and a preview. */
export function CompanyAccessPage({ companyId }: { companyId: CompanyId }) {
  const data = useApiQuery(
    async (client) => {
      const [companies, directory] = await Promise.all([
        client.listCompanies(),
        client.listCompanyDirectory(companyId),
      ]);
      return { company: companies.find((c) => c.id === companyId), ...directory };
    },
    [companyId],
  );
  if (data.status !== "ready") return <QueryFallback query={data} className="h-96" label="Loading company" />;
  const { company, roles, users } = data.data;
  if (!company) return <p className="text-muted-foreground">This company does not exist.</p>;
  return (
    <>
      <BackToCompanies />
      <AccessEditor key={JSON.stringify(company)} company={company} roles={roles} users={users} />
    </>
  );
}
