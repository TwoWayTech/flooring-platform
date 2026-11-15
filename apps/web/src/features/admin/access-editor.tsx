"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import {
  moduleInfo,
  offeredModules,
  PRODUCT_LABELS,
  type PlatformCompany,
  type PlatformAccessPatch,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Panel } from "@workspace/ui/components/panel";
import { Switch } from "@workspace/ui/components/switch";
import { AccessPreview, type PreviewRole } from "@/components/access-preview";
import { Field } from "@/components/field";
import { StepUpDialog } from "@/components/step-up-dialog";
import { PermissionMatrix } from "@/features/settings/roles/permission-matrix";
import { api, type ConsoleDirectory } from "@/lib/api";
import { isDemoMode } from "@/lib/data-source";
import { accessChanges, draftOf, hasPlan, limitProblem, type AccessDraft, type LimitField } from "./access-draft";
import { CompanyAdminNav } from "./company-admin-nav";
import { CompanyFacts } from "./company-facts";

const NO_PLAN_HINT = "On a trial with no plan there is no limit.";

/** The directory's roles for the preview; a default template has no id, so its key stands in. */
function previewRoles(directory: ConsoleDirectory): PreviewRole[] {
  return directory.restricted
    ? directory.roles.map((template) => ({ ...template, id: template.key }))
    : directory.roles;
}

interface LimitInputProps {
  field: LimitField;
  label: string;
  draft: AccessDraft;
  current: number | null;
  /** False on a trial with no plan, which has no limits to change. */
  editable: boolean;
  note?: string;
  onChange: (text: string) => void;
}

/** A user or branch limit: a whole number, refused inline before anything is sent. */
function LimitInput({ field, label, draft, current, editable, note, onChange }: LimitInputProps) {
  const id = field === "userLimit" ? "limit-users" : "limit-branches";
  const problem = editable ? limitProblem(draft[field], current) : null;
  const hint = problem ?? (editable ? note : NO_PLAN_HINT);
  return (
    <Field
      id={id}
      label={label}
      hint={hint ? <span className={problem ? "text-danger-ink" : undefined}>{hint}</span> : undefined}
    >
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={100000}
        step={1}
        placeholder="No limit"
        value={draft[field]}
        disabled={!editable}
        aria-invalid={problem ? true : undefined}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

interface AccessEditorProps {
  company: PlatformCompany;
  directory: ConsoleDirectory;
  /** Reads the company again after a save, where the data layer does not tell screens itself. */
  onSaved?: () => void;
}

/**
 * Platform admin → Company → Access (docs/specs/platform-admin.md, "Screens"; product spec rule
 * 24): the company's modules, permission ceiling and limits, with the effective-access preview on
 * the draft. Save sends only the parts that changed. The API asks for a fresh authenticator code on
 * every platform write, so in api mode Save goes through the step-up first; the demo saves at once,
 * as it always did.
 */
export function AccessEditor({ company, directory, onSaved }: AccessEditorProps) {
  const [draft, setDraft] = useState(() => draftOf(company));
  const [confirming, setConfirming] = useState(false);
  const changes = accessChanges(company, draft);
  const planned = hasPlan(company);
  const invalid = planned && (["userLimit", "branchLimit"] as const).some((f) => limitProblem(draft[f], company[f]));
  const modules = offeredModules(company.products).map(moduleInfo);
  const roles = previewRoles(directory);

  async function send(patch: PlatformAccessPatch) {
    try {
      await api.updatePlatformCompanyAccess(company.id, patch);
      setConfirming(false);
      toast.success(`Access saved for ${company.name}. It applies at once.`);
      onSaved?.();
    } catch (failure) {
      setConfirming(false);
      toast.error(failure instanceof Error ? failure.message : "Access was not saved.");
    }
  }

  function save() {
    if (!changes) return;
    if (isDemoMode()) void send(changes);
    else setConfirming(true);
  }

  return (
    <>
      <PageHeader
        title={company.name}
        description={`${company.products.map((p) => PRODUCT_LABELS[p]).join(" and ")}, ${company.plan}`}
        actions={
          <Button onClick={save} disabled={!changes || invalid}>
            <Save />
            Save access
          </Button>
        }
      />
      <CompanyAdminNav companyId={company.id} />
      <CompanyFacts company={company} />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Panel title="Modules and limits" bodyClassName="flex flex-col gap-4">
          <ul className="divide-hairline divide-y">
            {modules.map((m) => (
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
            <LimitInput
              field="userLimit"
              label="User limit"
              draft={draft}
              current={company.userLimit}
              editable={planned}
              onChange={(text) => setDraft({ ...draft, userLimit: text })}
            />
            <LimitInput
              field="branchLimit"
              label="Branch limit"
              draft={draft}
              current={company.branchLimit}
              editable={planned}
              note="Stored, not enforced yet."
              onChange={(text) => setDraft({ ...draft, branchLimit: text })}
            />
          </div>
        </Panel>
        <Panel title="Effective access preview">
          <AccessPreview
            products={company.products}
            roles={roles}
            users={directory.users}
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
          modules={modules.map((m) => m.key)}
          granted={draft.ceiling}
          lockOf={() => null}
          onToggle={(key, on) =>
            setDraft({ ...draft, ceiling: on ? [...draft.ceiling, key] : draft.ceiling.filter((k) => k !== key) })
          }
        />
      </Panel>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Panel title="Roles, read only" bodyClassName="p-0">
          {directory.restricted ? (
            <p className="text-muted-foreground border-hairline border-b px-4 py-2.5 text-sm">
              The default roles of the company&apos;s products.
            </p>
          ) : null}
          <ul className="divide-hairline divide-y text-sm">
            {roles.map((r) => (
              <li key={r.id} className="flex justify-between gap-4 px-4 py-2.5">
                <span className="font-medium">{r.name}</span>
                <span className="text-muted-foreground">{r.permissions.length} permissions</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Users, read only" bodyClassName={directory.restricted ? undefined : "p-0"}>
          {directory.restricted ? (
            <p className="text-muted-foreground max-w-prose text-sm">
              The company&apos;s users and custom roles need support access, which isn&apos;t available yet.
            </p>
          ) : (
            <ul className="divide-hairline divide-y text-sm">
              {directory.users.map((u) => (
                <li key={u.id} className="flex justify-between gap-4 px-4 py-2.5">
                  <span className="font-medium">{u.name}</span>
                  <span className="text-muted-foreground">
                    {directory.roles
                      .filter((r) => u.roleIds.includes(r.id))
                      .map((r) => r.name)
                      .join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      {changes ? (
        <StepUpDialog
          open={confirming}
          action={`Saving access for ${company.name}`}
          onOpenChange={setConfirming}
          onConfirm={() => send(changes)}
        />
      ) : null}
    </>
  );
}
