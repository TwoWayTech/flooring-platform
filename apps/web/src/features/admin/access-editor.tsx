"use client";

import { useState } from "react";
import { Eye, Save } from "lucide-react";
import { toast } from "sonner";
import {
  endSentence,
  mayChangeCompanyAccess,
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
import {
  accessChanges,
  ceilingLock,
  draftOf,
  hasPlan,
  limitProblem,
  saveProblem,
  type AccessDraft,
  type LimitField,
} from "./access-draft";
import { CompanyAdminNav } from "./company-admin-nav";
import { CompanyFacts } from "./company-facts";
import { usePlatformRole } from "./platform-role";

const NO_PLAN_HINT = "With no plan there is no limit.";

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
  /** False for a company with no plan, which has no limits to change. */
  editable: boolean;
  /** True for a role that may not change access: the field is disabled but keeps its own hint. */
  readOnly: boolean;
  note?: string;
  onChange: (text: string) => void;
}

/** A user or branch limit: a whole number, refused inline before anything is sent. */
function LimitInput({ field, label, draft, current, editable, readOnly, note, onChange }: LimitInputProps) {
  const id = field === "userLimit" ? "limit-users" : "limit-branches";
  const problem = editable && !readOnly ? limitProblem(draft[field], current) : null;
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
        disabled={!editable || readOnly}
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
}

/**
 * Platform admin → Company → Access (docs/specs/platform-admin.md, "Screens"; product spec rule
 * 24): the company's modules, permission ceiling and limits, with the effective-access preview on
 * the draft. Save sends only the parts that changed, after the API's shared check (part 3: a
 * refusal never asks for a code). The API asks for a fresh authenticator code on every platform
 * write, so in api mode Save goes through the step-up first; the demo saves at once, as it always
 * did. A role that may not change access (`mayChangeCompanyAccess`) sees the page read only, with
 * no Save and no step-up; the API's guard still decides.
 */
export function AccessEditor({ company, directory }: AccessEditorProps) {
  const readOnly = !mayChangeCompanyAccess(usePlatformRole());
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
      toast.success(`${endSentence(`Access saved for ${company.name}`)} It applies at once.`);
    } catch (failure) {
      setConfirming(false);
      toast.error(failure instanceof Error ? failure.message : "Access was not saved.");
    }
  }

  function save() {
    if (!changes || readOnly) return;
    const problem = saveProblem(company, changes);
    if (problem) {
      toast.error(problem);
      return;
    }
    if (isDemoMode()) void send(changes);
    else setConfirming(true);
  }

  return (
    <>
      <PageHeader
        title={company.name}
        description={`${company.products.map((p) => PRODUCT_LABELS[p]).join(" and ")}, ${company.plan}`}
        actions={
          readOnly ? undefined : (
            <Button onClick={save} disabled={!changes || invalid}>
              <Save />
              Save access
            </Button>
          )
        }
      />
      <CompanyAdminNav companyId={company.id} />
      {readOnly ? (
        <p
          role="note"
          className="border-hairline bg-raised text-muted-foreground flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
        >
          <Eye aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Read only: only the platform owner role can change a company&apos;s access.
        </p>
      ) : null}
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
                  disabled={readOnly || m.key === "platform"}
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
              readOnly={readOnly}
              onChange={(text) => setDraft({ ...draft, userLimit: text })}
            />
            <LimitInput
              field="branchLimit"
              label="Branch limit"
              draft={draft}
              current={company.branchLimit}
              editable={planned}
              readOnly={readOnly}
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
          lockOf={(key) => ceilingLock(key, draft.ceiling, readOnly)}
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
      {changes && !readOnly ? (
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
