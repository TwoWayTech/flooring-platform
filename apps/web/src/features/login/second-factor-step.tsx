"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { verifySecondFactor } from "@/lib/session/api-auth";

const TOTP_PATTERN = /^\d{6}$/;

interface SecondFactorStepProps {
  /** Called once the code is accepted and the session exists. */
  onVerified: () => Promise<void>;
  onBack: () => void;
}

/**
 * The second sign-in step for an account with an authenticator app (blueprint p27): the 6-digit
 * code, or one of the backup codes when the phone is not at hand.
 */
export function SecondFactorStep({ onVerified, onBack }: SecondFactorStepProps) {
  const [kind, setKind] = useState<"totp" | "backup">("totp");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function switchKind() {
    setKind(kind === "totp" ? "backup" : "totp");
    setCode("");
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const entered = code.trim();
    if (kind === "totp" ? !TOTP_PATTERN.test(entered) : entered === "") {
      setError(
        kind === "totp" ? "Enter the 6-digit code from your authenticator app." : "Enter one of your backup codes.",
      );
      return;
    }
    setPending(true);
    setError(null);
    const result = await verifySecondFactor(entered, kind);
    if (result.ok) {
      try {
        await onVerified();
        return;
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "Sign-in failed. Try again.");
      }
    } else {
      setError(result.message);
    }
    setPending(false);
  }

  const isTotp = kind === "totp";
  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="second-factor-code">{isTotp ? "Authenticator code" : "Backup code"}</Label>
        <Input
          id="second-factor-code"
          value={code}
          onChange={(event) => setCode(isTotp ? event.target.value.replace(/\D/g, "").slice(0, 6) : event.target.value)}
          inputMode={isTotp ? "numeric" : "text"}
          autoComplete="one-time-code"
          aria-invalid={error ? true : undefined}
          aria-describedby="second-factor-hint"
          className={isTotp ? "h-10 text-base tracking-[0.3em] tabular-nums" : "h-10 text-base"}
          autoFocus
        />
        <p
          id="second-factor-hint"
          role={error ? "alert" : undefined}
          className={error ? "text-danger-ink text-sm" : "text-muted-foreground text-xs"}
        >
          {error ??
            (isTotp ? "Open your authenticator app and enter the code it shows now." : "Each backup code works once.")}
        </p>
      </div>
      <Button type="submit" size="lg" disabled={pending} className="h-10">
        {pending ? "Checking" : "Continue"}
      </Button>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <button
          type="button"
          onClick={switchKind}
          className="text-brand-ink rounded-sm underline-offset-4 hover:underline"
        >
          {isTotp ? "Use a backup code instead" : "Use the authenticator app instead"}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="text-muted-foreground rounded-sm underline-offset-4 hover:underline"
        >
          Back to sign in
        </button>
      </div>
    </form>
  );
}
