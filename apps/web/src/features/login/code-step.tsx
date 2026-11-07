"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";

const CODE_PATTERN = /^\d{6}$/;
/** The hint the spec asks for; any six digits pass in the demo (spec section 2). */
export const DEMO_CODE = "123456";

interface CodeStepProps {
  who: string;
  pending: boolean;
  onSubmit: () => void;
}

/** Simulated MFA: a six-digit authenticator code, checked only for shape. */
export function CodeStep({ who, pending, onSubmit }: CodeStepProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!CODE_PATTERN.test(code)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setError(null);
    onSubmit();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mfa-code">Authenticator code</Label>
        <Input
          id="mfa-code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="6 digits"
          aria-invalid={error ? true : undefined}
          aria-describedby="mfa-hint"
          className="h-10 text-base tracking-[0.3em] tabular-nums placeholder:tracking-normal"
          autoFocus
        />
        <p id="mfa-hint" className={error ? "text-danger-ink text-xs" : "text-muted-foreground text-xs"}>
          {error ?? `Demo: any 6 digits work, for example ${DEMO_CODE}.`}
        </p>
      </div>
      <Button type="submit" size="lg" disabled={pending} className="h-10">
        {pending ? "Signing in" : `Sign in as ${who}`}
      </Button>
    </form>
  );
}
