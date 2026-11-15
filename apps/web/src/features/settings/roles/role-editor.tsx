"use client";

import { useState } from "react";
import { Copy, Lock, RotateCcw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { permissionDef, PRODUCT_MODULES, type DataScope, type PermissionKey, type Role } from "@workspace/shared";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Panel } from "@workspace/ui/components/panel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { StepUpDialog } from "@/components/step-up-dialog";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { PermissionMatrix, type CellLock } from "./permission-matrix";

const SCOPES: Record<DataScope, string> = {
  own: "Own records",
  branch: "Their branch",
  all: "Everything",
};

interface RoleEditorProps {
  role: Role;
  /** A new or copied role that has not been saved yet. */
  isNew: boolean;
  canManage: boolean;
  onCopy: (role: Role) => void;
  onSaved: (role: Role) => void;
  onDeleted: () => void;
}

/**
 * Edits one role: name, data scope and the permission matrix. Saving asks for a step-up code
 * (blueprint rule 5); the ApiClient refuses any permission the editor does not hold.
 */
export function RoleEditor({ role, isNew, canManage, onCopy, onSaved, onDeleted }: RoleEditorProps) {
  const { company, access, session } = useWorkspace();
  const [draft, setDraft] = useState(role);
  const [confirming, setConfirming] = useState(false);
  const editable = canManage && !role.owner;
  const dirty = isNew || draft !== role;

  function lockOf(key: PermissionKey): CellLock {
    if (role.owner) return "owner";
    if (!company.ceiling.includes(key)) return "plan";
    if (!company.modules.includes(permissionDef(key)!.module)) return "module";
    if (!canManage) return "owner";
    if (!access.permissions.has(key) && !role.permissions.includes(key)) return "not_held";
    return null;
  }

  async function save() {
    try {
      const saved = await api.saveRole(draft);
      toast.success(`Role ${saved.name} saved`);
      setConfirming(false);
      onSaved(saved);
    } catch (e) {
      setConfirming(false);
      toast.error(e instanceof Error ? e.message : "The role was not saved.");
    }
  }

  async function reset() {
    try {
      const saved = await api.resetRole(role.id);
      toast.success(`Role ${saved.name} reset to its default permissions`);
      onSaved(saved);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The role was not reset.");
    }
  }

  async function remove() {
    try {
      await api.deleteRole(role.id);
      toast.success(`Role ${role.name} deleted`);
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The role was not deleted.");
    }
  }

  return (
    <Panel
      title={
        role.owner ? (
          <span className="inline-flex items-center gap-1.5">
            <Lock aria-hidden="true" className="size-4" />
            {role.name}
          </span>
        ) : (
          <span className="inline-flex items-center gap-2">
            {draft.name || "Unnamed role"}
            {role.system ? <Badge variant="secondary">System</Badge> : null}
          </span>
        )
      }
      actions={
        canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => onCopy(draft)}>
              <Copy />
              Duplicate
            </Button>
            {role.system && !role.owner ? (
              <Button variant="outline" size="sm" onClick={() => void reset()}>
                <RotateCcw />
                Reset to default
              </Button>
            ) : null}
            {!role.system && !isNew ? (
              <Button variant="outline" size="sm" onClick={() => void remove()}>
                <Trash2 />
                Delete
              </Button>
            ) : null}
            {editable ? (
              <Button size="sm" onClick={() => setConfirming(true)} disabled={!dirty || !draft.name.trim()}>
                <Save />
                Save role
              </Button>
            ) : null}
          </div>
        ) : null
      }
      bodyClassName="flex flex-col gap-5"
    >
      {role.owner ? (
        <p className="bg-raised rounded-md px-3 py-2 text-sm">
          The Owner role always holds everything in your plan. It cannot be edited or deleted, and at least one active
          Owner must remain.
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_12rem]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="role-name">Name</Label>
          <Input
            id="role-name"
            value={draft.name}
            disabled={!editable || role.system}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="role-description">Description</Label>
          <Input
            id="role-description"
            value={draft.description}
            disabled={!editable}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="role-scope">Data scope</Label>
          <Select
            value={draft.dataScope}
            onValueChange={(v) => setDraft({ ...draft, dataScope: v as DataScope })}
            disabled={!editable}
          >
            <SelectTrigger id="role-scope" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SCOPES) as DataScope[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {SCOPES[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <PermissionMatrix
        modules={PRODUCT_MODULES[session.product]}
        granted={role.owner ? company.ceiling : draft.permissions}
        lockOf={lockOf}
        onToggle={(key, on) =>
          setDraft({
            ...draft,
            permissions: on ? [...draft.permissions, key] : draft.permissions.filter((p) => p !== key),
          })
        }
      />
      <StepUpDialog
        open={confirming}
        action={`Saving role ${draft.name}`}
        onOpenChange={setConfirming}
        onConfirm={save}
      />
    </Panel>
  );
}
