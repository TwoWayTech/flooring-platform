"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { cn } from "@workspace/ui/lib/utils";
import { PasskeyNameStep } from "@/features/account/passkey-name-step";
import { api } from "@/lib/api";
import { failureWords } from "@/lib/api/errors";
import { confirmTotpEnrolment, startTotpEnrolment, type TotpEnrolment } from "@/lib/session/api-auth";
import { passkeysSupported } from "@/lib/session/webauthn";
import { useHydrated } from "@/lib/use-hydrated";
import { QrCode } from "./qr-code";

const TOTP_PATTERN = /^\d{6}$/;

/** The two second factors a person can set up (blueprint p27; ADR 0060). */
type Method = "app" | "passkey";

/** Steps per method: password, key, backup codes; or password, then the passkey. */
const STEP_COUNT: Record<Method, number> = { app: 3, passkey: 2 };

interface MfaEnrolmentProps {
  /** Called when set-up is confirmed and the backup codes are saved. */
  onDone: () => Promise<void>;
  onSignOut: () => Promise<void>;
}

type Phase =
  | { kind: "password"; notice: string | null }
  | { kind: "add-key"; enrolment: TotpEnrolment }
  | { kind: "codes"; codes: string[] }
  | { kind: "passkey-name" }
  | { kind: "passkey-done" };

const STEP_OF: Record<Phase["kind"], number> = {
  password: 1,
  "add-key": 2,
  codes: 3,
  "passkey-name": 2,
  "passkey-done": 2,
};

/** The secret in the otpauth link, which the person types into their authenticator app. */
function setupKey(totpURI: string): string {
  return new URL(totpURI).searchParams.get("secret") ?? "";
}

/** The key in groups of four, so it is easier to read and type without a mistake. */
function groupKey(key: string): string[] {
  return key.match(/.{1,4}/g) ?? [];
}

/**
 * Mandatory MFA set-up at sign-in (blueprint p27; ADR 0029, part 2; ADR 0060). The person chooses
 * an authenticator app or a passkey and confirms the password. For the app: scan the QR code (or
 * type the key), enter its first code, then save the backup codes. For a passkey: name it and
 * answer the browser's prompt; the password was confirmed with `/verify-password` first.
 */
export function MfaEnrolment({ onDone, onSignOut }: MfaEnrolmentProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "password", notice: null });
  const [method, setMethod] = useState<Method>("app");
  const step = STEP_OF[phase.kind];
  const finished = phase.kind === "codes" || phase.kind === "passkey-done";

  return (
    <section aria-labelledby="mfa-enrolment" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="mfa-enrolment" className="font-semibold">
          Set up two-step sign-in
        </h2>
        <p className="text-muted-foreground text-sm">
          Your role needs a second step each time you sign in. Step {step} of {STEP_COUNT[method]}.
        </p>
      </div>
      {phase.kind === "password" ? (
        <PasswordCheck
          method={method}
          onMethod={setMethod}
          notice={phase.notice}
          onStarted={(enrolment) => setPhase({ kind: "add-key", enrolment })}
          onPasskeyReady={() => setPhase({ kind: "passkey-name" })}
        />
      ) : phase.kind === "add-key" ? (
        <AddKey
          enrolment={phase.enrolment}
          onConfirmed={() => setPhase({ kind: "codes", codes: phase.enrolment.backupCodes })}
        />
      ) : phase.kind === "codes" ? (
        <BackupCodes codes={phase.codes} onDone={onDone} />
      ) : phase.kind === "passkey-name" ? (
        <>
          <PasskeyNameStep
            idPrefix="mfa"
            onAdded={() => setPhase({ kind: "passkey-done" })}
            onPasswordExpired={(notice) => setPhase({ kind: "password", notice })}
          />
          <button
            type="button"
            onClick={() => {
              setMethod("app");
              setPhase({ kind: "password", notice: null });
            }}
            className="text-brand-ink self-start rounded-sm text-sm underline-offset-4 hover:underline"
          >
            Use an authenticator app instead
          </button>
        </>
      ) : (
        <PasskeyDone onDone={onDone} />
      )}
      {!finished ? (
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

interface PasswordCheckProps {
  method: Method;
  onMethod: (method: Method) => void;
  /** Why the password is asked again, such as a password check that ran out. */
  notice: string | null;
  onStarted: (enrolment: TotpEnrolment) => void;
  onPasskeyReady: () => void;
}

/**
 * Confirms the password for the chosen method: `two-factor/enable` for the app (which answers the
 * link and backup codes), `/verify-password` for a passkey (null when it passed).
 */
async function confirmFor(method: Method, password: string): Promise<TotpEnrolment | { message: string } | null> {
  if (method === "app") return startTotpEnrolment(password);
  try {
    await api.confirmPassword(password);
    return null;
  } catch (failure) {
    return { message: failureWords(failure) };
  }
}

function PasswordCheck({ method, onMethod, notice, onStarted, onPasskeyReady }: PasswordCheckProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(notice);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await confirmFor(method, password);
    setPending(false);
    if (result === null) onPasskeyReady();
    else if ("message" in result) setError(result.message);
    else onStarted(result);
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3" noValidate>
      <MethodChoice method={method} onMethod={onMethod} />
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
      <div className="flex flex-col gap-3">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <QrCode value={enrolment.totpURI} label="QR code for your authenticator app" />
          <p className="text-sm">
            In your authenticator app, add an account and scan this code with your phone&apos;s camera.
          </p>
        </div>
        <p className="text-muted-foreground text-sm">
          Cannot scan it? Choose to enter a setup key instead, and type this one as a time-based key:
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

const METHODS: { value: Method; title: string; detail: string }[] = [
  { value: "app", title: "Authenticator app", detail: "A 6-digit code from an app on your phone." },
  {
    value: "passkey",
    title: "Passkey",
    detail: "Your fingerprint, face or device PIN, on this device or a security key.",
  },
];

/** The choice of second factor, as a radio group; a browser without WebAuthn offers the app only. */
function MethodChoice({ method, onMethod }: { method: Method; onMethod: (method: Method) => void }) {
  const hydrated = useHydrated();
  const canPasskey = hydrated && passkeysSupported();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">How do you want to confirm it is you?</legend>
      {METHODS.map((option) => {
        const disabled = option.value === "passkey" && !canPasskey;
        return (
          <label
            key={option.value}
            className={cn(
              "has-[:focus-visible]:ring-ring/50 flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors has-[:focus-visible]:ring-3",
              method === option.value ? "border-brand bg-brand-soft" : "border-hairline hover:bg-raised",
              disabled && "cursor-not-allowed opacity-60",
            )}
          >
            <input
              type="radio"
              name="mfa-method"
              value={option.value}
              checked={method === option.value}
              disabled={disabled}
              onChange={() => onMethod(option.value)}
              className="accent-brand mt-1 size-4"
            />
            <span className="flex flex-col">
              <span className="text-sm font-medium">{option.title}</span>
              <span className="text-muted-foreground text-xs">
                {disabled ? "This browser cannot use passkeys." : option.detail}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

function PasskeyDone({ onDone }: { onDone: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function finish() {
    setPending(true);
    setError(null);
    try {
      await onDone();
    } catch (failure) {
      setError(failureWords(failure));
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Notice>
        Two-step sign-in is on. Next time, choose Sign in with a passkey: your password alone will not sign you in. Add
        a second passkey on another device from Sign-in and security, so a lost device does not lock you out.
      </Notice>
      <FieldError id="mfa-passkey-done-error" message={error} />
      <Button type="button" size="lg" disabled={pending} className="h-10" onClick={() => void finish()}>
        {pending ? "Opening" : "Continue"}
      </Button>
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return <p className="bg-brand-soft text-brand-ink rounded-md px-3 py-2 text-sm">{children}</p>;
}
