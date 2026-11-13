"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { MailCheck } from "lucide-react";
import type { ProductKey } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
  acceptInvitation,
  fetchInvitation,
  requestPasswordReset,
  resetPassword,
  type InvitationInfo,
} from "@/lib/session/api-auth";
import { PRODUCTS } from "@/products";
import { LoginLayout } from "./login-layout";

/** Shortest password accepted, as at sign-in (blueprint p27). */
const MIN_PASSWORD = 12;

/** The login page's frame for this product, with a subtitle. */
function Frame({ product, subtitle, children }: { product: ProductKey; subtitle: string; children: ReactNode }) {
  const config = PRODUCTS[product];
  return (
    <LoginLayout
      brandColor={config.defaultBranding.brandColor}
      pattern={config.defaultBranding.pattern}
      title={config.name}
      subtitle={subtitle}
    >
      {children}
    </LoginLayout>
  );
}

function ErrorLine({ id, message }: { id: string; message: string | null }) {
  return message ? (
    <p id={id} role="alert" className="text-danger-ink text-sm">
      {message}
    </p>
  ) : null;
}

function BackToSignIn() {
  return (
    <Link href="/login" className="text-brand-ink text-sm underline-offset-4 hover:underline">
      Back to sign in
    </Link>
  );
}

/** A new password typed twice; checks the length and that both match before `onSubmit`. */
function NewPasswordForm({
  submitLabel,
  onSubmit,
}: {
  submitLabel: string;
  onSubmit: (password: string) => Promise<string | null>;
}) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
    if (password !== again) return setError("The two passwords are not the same.");
    setPending(true);
    setError(await onSubmit(password));
    setPending(false);
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-password">New password</Label>
        <Input
          id="new-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          aria-describedby="new-password-hint"
          className="h-10 text-base"
          autoFocus
        />
        <p id="new-password-hint" className="text-muted-foreground text-xs">
          At least {MIN_PASSWORD} characters. A short sentence is easy to remember.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-password-again">Type it again</Label>
        <Input
          id="new-password-again"
          type="password"
          value={again}
          onChange={(event) => setAgain(event.target.value)}
          autoComplete="new-password"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "new-password-error" : undefined}
          className="h-10 text-base"
        />
      </div>
      <ErrorLine id="new-password-error" message={error} />
      <Button type="submit" size="lg" disabled={pending} className="h-10">
        {pending ? "Saving" : submitLabel}
      </Button>
    </form>
  );
}

/** Forgot password: asks for an email and always answers the same way (draft spec "Password reset"). */
export function ForgotPassword({ product }: { product: ProductKey }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) return setError("Enter your email address.");
    setPending(true);
    const result = await requestPasswordReset(email.trim());
    setPending(false);
    if (result.ok) setSent(true);
    else setError(result.message);
  }

  return (
    <Frame product={product} subtitle="Reset your password">
      {sent ? (
        <div className="flex flex-col gap-4">
          <div className="flex gap-3">
            <MailCheck aria-hidden="true" className="text-brand-ink mt-0.5 size-5 shrink-0" />
            <p className="text-muted-foreground text-sm" role="status">
              If <span className="text-foreground font-medium">{email.trim()}</span> has an account, we sent it a link
              to choose a new password. The link works for one hour.
            </p>
          </div>
          <BackToSignIn />
        </div>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reset-email">Email</Label>
            <Input
              id="reset-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              inputMode="email"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "reset-email-error" : undefined}
              className="h-10 text-base"
              autoFocus
            />
          </div>
          <ErrorLine id="reset-email-error" message={error} />
          <Button type="submit" size="lg" disabled={pending} className="h-10">
            {pending ? "Sending" : "Email me a link"}
          </Button>
          <BackToSignIn />
        </form>
      )}
    </Frame>
  );
}

/** Choose a new password from a reset link (`?token=`); a bad or old link says so. */
export function ResetPassword({ product, token }: { product: ProductKey; token: string | null }) {
  const [done, setDone] = useState(false);
  return (
    <Frame product={product} subtitle="Choose a new password">
      {!token ? (
        <div className="flex flex-col gap-4">
          <p role="alert" className="text-danger-ink text-sm">
            This reset link has expired or was already used. Ask for a new one.
          </p>
          <Link href="/forgot-password" className="text-brand-ink text-sm underline-offset-4 hover:underline">
            Send a new link
          </Link>
        </div>
      ) : done ? (
        <div className="flex flex-col gap-4">
          <p role="status" className="text-sm">
            Your password is changed, and you were signed out everywhere. Sign in with the new password.
          </p>
          <BackToSignIn />
        </div>
      ) : (
        <NewPasswordForm
          submitLabel="Save new password"
          onSubmit={async (password) => {
            const result = await resetPassword(token, password);
            if (result.ok) setDone(true);
            return result.ok ? null : result.message;
          }}
        />
      )}
    </Frame>
  );
}

/**
 * Accept an invitation from its emailed link: names the company, sets the password of a new
 * account, then sends the person to sign in, where MFA set-up follows for roles that need it.
 */
export function AcceptInvitation({ product, token }: { product: ProductKey; token: string | null }) {
  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [problem, setProblem] = useState<string | null>(token ? null : "This invitation link is not complete.");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    void fetchInvitation(token).then((result) => ("message" in result ? setProblem(result.message) : setInfo(result)));
  }, [token]);

  async function accept(password: string | undefined): Promise<string | null> {
    const result = await acceptInvitation(token ?? "", password);
    if (result.ok) setDone(true);
    return result.ok ? null : result.message;
  }

  return (
    <Frame product={product} subtitle={info ? `Join ${info.companyName}` : "Accept your invitation"}>
      {problem ? (
        <div className="flex flex-col gap-4">
          <p role="alert" className="text-danger-ink text-sm">
            {problem}
          </p>
          <BackToSignIn />
        </div>
      ) : done ? (
        <div className="flex flex-col gap-4">
          <p role="status" className="text-sm">
            You are in. Sign in with {info?.email}. If your role needs it, you will set up an authenticator app next.
          </p>
          <BackToSignIn />
        </div>
      ) : !info ? (
        <p className="text-muted-foreground text-sm" role="status">
          Checking your invitation…
        </p>
      ) : info.needsPassword ? (
        <div className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            Choose a password for <span className="text-foreground font-medium">{info.email}</span>.
          </p>
          <NewPasswordForm submitLabel="Accept and set password" onSubmit={(password) => accept(password)} />
        </div>
      ) : (
        <AcceptExisting email={info.email} onAccept={() => accept(undefined)} />
      )}
    </Frame>
  );
}

function AcceptExisting({ email, onAccept }: { email: string; onAccept: () => Promise<string | null> }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        You already have an account as <span className="text-foreground font-medium">{email}</span>. Accept to add this
        company, then sign in with your usual password.
      </p>
      <ErrorLine id="accept-error" message={error} />
      <Button
        size="lg"
        className="h-10"
        disabled={pending}
        onClick={() => {
          setPending(true);
          void onAccept().then((message) => {
            setError(message);
            setPending(false);
          });
        }}
      >
        {pending ? "Accepting" : "Accept invitation"}
      </Button>
    </div>
  );
}
