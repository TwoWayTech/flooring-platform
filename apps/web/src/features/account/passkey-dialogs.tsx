"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
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
import { api } from "@/lib/api";
import { failureWords } from "@/lib/api/errors";
import { isDemoMode } from "@/lib/data-source";
import { PASSKEY_NAME_MAX, passkeyNameProblem, type PasskeySummary } from "@/lib/session/passkeys";
import { PasskeyNameStep } from "./passkey-name-step";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** A field's error or hint under it, announced when it is an error. */
function Hint({ id, error, children }: { id: string; error: string | null; children?: ReactNode }) {
  if (!error && !children) return null;
  return (
    <p
      id={id}
      role={error ? "alert" : undefined}
      className={error ? "text-danger-ink text-sm" : "text-muted-foreground text-xs"}
    >
      {error ?? children}
    </p>
  );
}

/** Runs a write and shows what went wrong in the person's words; the button is freed either way. */
function useWrite() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function run(write: () => Promise<void>): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      await write();
      return true;
    } catch (failure) {
      setError(failureWords(failure));
      return false;
    } finally {
      setPending(false);
    }
  }
  return { error, setError, pending, run };
}

/**
 * Adds a passkey (ADR 0060): the password first, every time (`/verify-password`, good for 5
 * minutes on this session), then a name and the browser's prompt. The API emails the account.
 */
export function AddPasskeyDialog({ open, onOpenChange }: DialogProps) {
  const [phase, setPhase] = useState<"password" | "name">("password");
  const [password, setPassword] = useState("");
  const { error, setError, pending, run } = useWrite();

  function reset(next: boolean) {
    if (!next) {
      setPhase("password");
      setPassword("");
      setError(null);
    }
    onOpenChange(next);
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!password) {
      setError("Enter your password.");
      return;
    }
    if (await run(() => api.confirmPassword(password))) {
      setPassword("");
      setPhase("name");
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="bg-surface sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add a passkey</DialogTitle>
          <DialogDescription>
            {phase === "password"
              ? isDemoMode()
                ? "Confirm your password first."
                : "A passkey can be added in the first 10 minutes after you sign in. Confirm your password first; then you have 5 minutes to make it."
              : isDemoMode()
                ? "Name the passkey."
                : "Name the passkey. We email you whenever one is added to your account."}
          </DialogDescription>
        </DialogHeader>
        {phase === "password" ? (
          <form onSubmit={(event) => void confirm(event)} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-passkey-password">Your password</Label>
              <Input
                id="add-passkey-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                aria-invalid={error ? true : undefined}
                aria-describedby="add-passkey-password-hint"
                autoFocus
              />
              <Hint id="add-passkey-password-hint" error={error}>
                {isDemoMode() ? "Demo: any password works." : null}
              </Hint>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => reset(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Checking" : "Continue"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <PasskeyNameStep
            idPrefix="add"
            onAdded={() => {
              toast.success("Passkey added");
              reset(false);
            }}
            onPasswordExpired={(message) => {
              setPhase("password");
              setError(message);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Renames one passkey; the name is 1 to 60 characters. */
export function RenamePasskeyDialog({
  passkey,
  onOpenChange,
}: { passkey: PasskeySummary } & Omit<DialogProps, "open">) {
  const [name, setName] = useState(passkey.name);
  const { error, setError, pending, run } = useWrite();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = passkeyNameProblem(name);
    if (problem) {
      setError(problem);
      return;
    }
    if (await run(() => api.renamePasskey(passkey.id, name))) {
      toast.success("Passkey renamed");
      onOpenChange(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface sm:max-w-sm">
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Rename passkey</DialogTitle>
            <DialogDescription>Use a name that tells you which device it is on.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rename-passkey-name">Passkey name</Label>
            <Input
              id="rename-passkey-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={PASSKEY_NAME_MAX}
              autoComplete="off"
              aria-invalid={error ? true : undefined}
              aria-describedby="rename-passkey-hint"
              autoFocus
            />
            <Hint id="rename-passkey-hint" error={error} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving" : "Save name"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Removes one passkey after a confirmation. The API refuses the last factor of a role that needs
 * two-step sign-in (403 `mfa_required`), and the dialog says why.
 */
export function RemovePasskeyDialog({
  passkey,
  onOpenChange,
}: { passkey: PasskeySummary } & Omit<DialogProps, "open">) {
  const { error, pending, run } = useWrite();

  async function remove() {
    if (await run(() => api.deletePasskey(passkey.id))) {
      toast.success("Passkey removed");
      onOpenChange(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Remove {passkey.name}?</DialogTitle>
          <DialogDescription>
            It stops working for signing in to this account at once. The copy on the device stays until you delete it
            there.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-danger-ink text-sm">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Keep it
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={() => void remove()}>
            {pending ? "Removing" : "Remove passkey"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
