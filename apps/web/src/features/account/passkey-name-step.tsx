"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { api } from "@/lib/api";
import { apiErrorCode, ApiError } from "@/lib/api/errors";
import { isDemoMode } from "@/lib/data-source";
import { defaultPasskeyName, PASSKEY_NAME_MAX, passkeyNameProblem } from "@/lib/session/passkeys";

interface PasskeyNameStepProps {
  /** Called once the API has stored the passkey. */
  onAdded: () => void;
  /**
   * The password check ran out before the passkey was made (403 `password_confirmation_required`),
   * so the screen asks for the password again; the message says why.
   */
  onPasswordExpired: (message: string) => void;
  /** Prefixes the field's id, so two of these never share one on a page. */
  idPrefix: string;
}

/**
 * The second half of adding a passkey (ADR 0060), after the password is confirmed: a name, then
 * the browser's own prompt (fingerprint, face, device PIN or a security key). The demo makes a
 * simulated passkey with no prompt.
 */
export function PasskeyNameStep({ onAdded, onPasswordExpired, idPrefix }: PasskeyNameStepProps) {
  const [name, setName] = useState(() => defaultPasskeyName(navigator.userAgent));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const fieldId = `${idPrefix}-passkey-name`;
  const hintId = `${fieldId}-hint`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = passkeyNameProblem(name);
    if (problem) {
      setError(problem);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api.addPasskey(name);
      onAdded();
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      if (apiErrorCode(failure) === "password_confirmation_required") onPasswordExpired(failure.message);
      else setError(failure.message);
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={fieldId}>Passkey name</Label>
        <Input
          id={fieldId}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={PASSKEY_NAME_MAX}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={hintId}
          className="h-10 text-base"
          autoFocus
        />
        <p
          id={hintId}
          role={error ? "alert" : undefined}
          className={error ? "text-danger-ink text-sm" : "text-muted-foreground text-xs"}
        >
          {error ??
            (isDemoMode()
              ? "Demo: no real passkey is made, and no prompt opens."
              : "Name it after the device, so you know which one to remove if it is lost. Your browser asks for your fingerprint, face or device PIN next.")}
        </p>
      </div>
      <Button type="submit" size="lg" disabled={pending} className="h-10">
        {pending ? "Waiting for your device" : "Create passkey"}
      </Button>
    </form>
  );
}
