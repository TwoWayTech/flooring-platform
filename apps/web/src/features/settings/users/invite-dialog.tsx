"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import type { Branch, Role } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { StepUpDialog } from "@/components/step-up-dialog";
import { api } from "@/lib/api";
import { RoleChecklist } from "./role-checklist";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface InviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: Role[];
  branches: Branch[];
  /** The branch picked first: the inviter's own when it is listed (`inviteBranches`). */
  defaultBranchId: string;
  /** False for an admin below scope `all` with no branch of their own: the API would refuse any invite. */
  canInvite: boolean;
}

const NO_BRANCH = "You can only invite people to your own branch, and you have none. Ask an Owner to set your branch.";

/** Invite a user with one or more roles and a branch; the seat limit is enforced by the ApiClient. */
export function InviteDialog({ open, onOpenChange, roles, branches, defaultBranchId, canInvite }: InviteDialogProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  /** Checks the form, then asks for a step-up code: inviting gives roles (draft spec "Step-up"). */
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canInvite) return setError(NO_BRANCH);
    if (!name.trim()) return setError("Enter the person's name.");
    if (!EMAIL.test(email)) return setError("Enter a valid email address, for example jo@company.com.");
    if (roleIds.length === 0) return setError("Pick at least one role.");
    setError(null);
    setConfirming(true);
  }

  async function send() {
    try {
      const user = await api.inviteUser({
        name: name.trim(),
        email: email.trim(),
        title: title.trim(),
        roleIds,
        branchId,
      });
      toast.success(`Invitation sent to ${user.email}`);
      setName("");
      setEmail("");
      setTitle("");
      setRoleIds([]);
      setError(null);
      setConfirming(false);
      onOpenChange(false);
    } catch (e) {
      setConfirming(false);
      setError(e instanceof Error ? e.message : "The invitation was not sent. Try again.");
    }
  }

  return (
    <>
      <Dialog open={open && !confirming} onOpenChange={onOpenChange}>
        <DialogContent className="bg-surface max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>Invite user</DialogTitle>
              <DialogDescription>They get an email to set a password and enroll MFA.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="invite-name">Name</Label>
                <Input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="invite-title">Job title</Label>
                <Input id="invite-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="invite-branch">Branch</Label>
                <Select value={branchId} onValueChange={setBranchId}>
                  <SelectTrigger id="invite-branch" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <RoleChecklist roles={roles} selected={roleIds} onChange={setRoleIds} />
            {error ? (
              <p role="alert" className="text-danger-ink text-sm">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit">Send invitation</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <StepUpDialog
        open={confirming}
        action={`Inviting ${name.trim() || "a person"}`}
        onOpenChange={setConfirming}
        onConfirm={send}
      />
    </>
  );
}
