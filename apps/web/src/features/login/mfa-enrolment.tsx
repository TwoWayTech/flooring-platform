"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { confirmTotpEnrolment, startTotpEnrolment, type TotpEnrolment } from "@/lib/session/api-auth";

const TOTP_PATTERN = /^\d{6}$/;
const STEP_COUNT = 3;

interface MfaEnrolmentProps {
  /** Called when set-up is confirmed and the backup codes are saved. */
  onDone: () => Promise<void>;
  onSignOut: () => Promise<void>;
}

type Phase = { kind: "password" } | { kind: "add-key"; enrolment: TotpEnrolment } | { kind: "codes"; codes: string[] };

/** The secret in the otpauth link, which the person types into their authenticator app. */
function setupKey(totpURI: string): string {
  return new URL(totpURI).searchParams.get("secret") ?? "";
}

/** The key in groups of four, so it is easier to read and type without a mistake. */
function groupKey(key: string): string[] {
  return key.match(/.{1,4}/g) ?? [];
}

/**
 * Mandatory MFA set-up at sign-in (blueprint p27; ADR 0029, part 2): confirm the password, add the
 * key to an authenticator app and enter its first code, then save the backup codes. Passkeys and
 * a QR code come with the passkey screens.
 */
export function MfaEnrolment({ onDone, onSignOut }: MfaEnrolmentProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "password" });
  const step = phase.kind === "password" ? 1 : phase.kind === "add-key" ? 2 : 3;

  return (
    <section aria-labelledby="mfa-enrolment" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="mfa-enrolment" className="font-semibold">
          Set up two-step sign-in
        </h2>
        <p className="text-muted-foreground text-sm">
          Your role needs a code from an authenticator app each time you sign in. Step {step} of {STEP_COUNT}.
        </p>
      </div>
      {phase.kind === "password" ? (
        <PasswordCheck onStarted={(enrolment) => setPhase({ kind: "add-key", enrolment })} />
      ) : phase.kind === "add-key" ? (
        <AddKey
          enrolment={phase.enrolment}
          onConfirmed={() => setPhase({ kind: "codes", codes: phase.enrolment.backupCodes })}
        />
      ) : (
        <BackupCodes codes={phase.codes} onDone={onDone} />
      )}
      {phase.kind !== "codes" ? (
        <button
          type="button"
          onClick={() => void onSignOut()}
          className="text-muted-foreground self-start rounded-sm text-sm underline-offset-4 hover:underline"
        >
          Sign out and do this later
        </button>
      ) : null}
    </section>
  );
}

function FieldError({ id, message }: { id: string; message: string | null }) {
  return message ? (
    <p id={id} role="alert" className="text-danger-ink text-sm">
      {message}
    </p>
  ) : null;
}

function PasswordCheck({ onStarted }: { onStarted: (enrolment: TotpEnrolment) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await startTotpEnrolment(password);
    setPending(false);
    if ("message" in result) setError(result.message);
    else onStarted(result);
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mfa-password">Confirm your password</Label>
        <Input
          id="mfa-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "mfa-password-error" : undefined}
          className="h-10 text-base"
          autoFocus
        />
      </div>
      <FieldError id="mfa-password-error" message={error} />
      <Button type="submit" size="lg" disabled={pending} className="h-10">
        {pending ? "Checking" : "Continue"}
      </Button>
    </form>
  );
}

function AddKey({ enrolment, onConfirmed }: { enrolment: TotpEnrolment; onConfirmed: () => void }) {
  const key = setupKey(enrolment.totpURI);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!TOTP_PATTERN.test(code)) {
      setError("Enter the 6-digit code your authenticator app shows.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await confirmTotpEnrolment(code);
    setPending(false);
    if (result.ok) onConfirmed();
    else setError(result.message);
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <p className="text-sm">
          In your authenticator app, add an account and choose to enter a setup key. Type this key, as a time-based key:
        </p>
        <div className="border-hairline bg-raised flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-3">
          <code
            aria-label="Setup key"
            data-testid="mfa-setup-key"
            data-key={key}
            className="flex flex-wrap gap-x-2 gap-y-1 text-base font-medium tabular-nums"
          >
            {groupKey(key).map((group, index) => (
              <span key={index}>{group}</span>
            ))}
          </code>
          <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy key"}
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mfa-first-code">Code from the app</Label>
        <Input
          id="mfa-first-code"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "mfa-first-code-error" : undefined}
          className="h-10 text-base tracking-[0.3em] tabular-nums"
        />
      </div>
      <FieldError id="mfa-first-code-error" message={error} />
      <Button type="submit" size="lg" disabled={pending} className="h-10">
        {pending ? "Checking" : "Turn on two-step sign-in"}
      </Button>
    </form>
  );
}

function BackupCodes({ codes, onDone }: { codes: string[]; onDone: () => Promise<void> }) {
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function finish() {
    setPending(true);
    setError(null);
    try {
      await onDone();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Something went wrong. Try again.");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Notice>
        Two-step sign-in is on. Save these backup codes somewhere safe, away from your phone. Each one signs you in once
        if your phone is lost. They are shown only now.
      </Notice>
      <ul aria-label="Backup codes" className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-base font-medium tabular-nums">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
          className="accent-brand mt-0.5 size-4"
        />
        I have saved my backup codes
      </label>
      <FieldError id="mfa-done-error" message={error} />
      <Button type="button" size="lg" disabled={!saved || pending} className="h-10" onClick={() => void finish()}>
        {pending ? "Opening" : "Continue"}
      </Button>
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return <p className="bg-brand-soft text-brand-ink rounded-md px-3 py-2 text-sm">{children}</p>;
}
