"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { Role, User } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { StepUpDialog } from "@/components/step-up-dialog";
import { api } from "@/lib/api";
import { RoleChecklist } from "./role-checklist";

/** Changes a user's roles after a step-up code; refusals (last Owner, escalation) come back as messages. */
export function ChangeRolesDialog({ user, roles, onClose }: { user: User; roles: Role[]; onClose: () => void }) {
  const [roleIds, setRoleIds] = useState(user.roleIds);
  const [confirming, setConfirming] = useState(false);

  async function save() {
    try {
      await api.updateUser(user.id, { roleIds });
      toast.success(`Roles updated for ${user.name}`);
      onClose();
    } catch (e) {
      setConfirming(false);
      toast.error(e instanceof Error ? e.message : "The roles were not changed.");
    }
  }

  return (
    <>
      <Dialog open={!confirming} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="bg-surface max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Roles for {user.name}</DialogTitle>
            <DialogDescription>Effective access is the union of these roles, within your plan.</DialogDescription>
          </DialogHeader>
          <RoleChecklist roles={roles} selected={roleIds} current={user.roleIds} onChange={setRoleIds} />
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => setConfirming(true)} disabled={roleIds.length === 0}>
              Save roles
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <StepUpDialog
        open={confirming}
        action={`Changing roles for ${user.name}`}
        onOpenChange={setConfirming}
        onConfirm={save}
      />
    </>
  );
}
