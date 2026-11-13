"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { MailCheck } from "lucide-react";
import type { ProductKey } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { fetchSessionContext, openCompany, signInWithPassword, signOutOfApi } from "@/lib/session/api-auth";
import type { ContextCompany } from "@/lib/session/api-context";
import { PRODUCTS } from "@/products";
import { LoginLayout } from "./login-layout";
import { MfaEnrolment } from "./mfa-enrolment";
import { SecondFactorStep } from "./second-factor-step";

/**
 * Where the sign-in stands: the form, the authenticator code, MFA set-up, waiting for the email
 * link, choosing a company, or no profile yet.
 */
export type SignInStage =
  | { kind: "sign-in" }
  | { kind: "second-factor" }
  | { kind: "enrol" }
  | { kind: "verify-email"; email: string }
  | { kind: "choose"; companies: ContextCompany[] }
  | { kind: "no-profile" };

interface ApiSignInProps {
  product: ProductKey;
  initial: SignInStage;
  /** The user just confirmed their email through the link (VERIFIED_CALLBACK). */
  verified: boolean;
}

const SUBTITLES: Record<SignInStage["kind"], string> = {
  "sign-in": "Sign in with your work email.",
  "second-factor": "One more step to confirm it is you.",
  enrol: "Protect your account before you continue.",
  "verify-email": "One more step before you sign in.",
  choose: "You belong to more than one company.",
  "no-profile": "Your account is ready, but not this workspace.",
};

/**
 * The real sign-in (P8; blueprint p27): email and password through Better Auth, the authenticator
 * code for accounts that have one, MFA set-up for roles that require it, a "check your email" step
 * for unconfirmed addresses, and a company chooser for people in more than one company. Same frame
 * as the demo login.
 */
export function ApiSignIn({ product, initial, verified }: ApiSignInProps) {
  const router = useRouter();
  const config = PRODUCTS[product];
  const [stage, setStage] = useState<SignInStage>(initial);

  function enterApp() {
    router.replace("/");
    router.refresh();
  }

  /** After any step that may have opened a session: set up MFA, choose a company, or go in. */
  async function continueSignedIn() {
    const context = await fetchSessionContext();
    if (context.mfa.state === "enrolment_required") setStage({ kind: "enrol" });
    else if (context.company) enterApp();
    else setStage({ kind: "choose", companies: context.companies });
  }

  async function signOut() {
    await signOutOfApi();
    setStage({ kind: "sign-in" });
  }

  return (
    <LoginLayout
      brandColor={config.defaultBranding.brandColor}
      pattern={config.defaultBranding.pattern}
      title={config.name}
      subtitle={SUBTITLES[stage.kind]}
    >
      {stage.kind === "sign-in" ? (
        <PasswordForm
          notice={verified ? "Your email is confirmed. Sign in to continue." : null}
          onVerifyEmail={(email) => setStage({ kind: "verify-email", email })}
          onSecondFactor={() => setStage({ kind: "second-factor" })}
          onSignedIn={continueSignedIn}
        />
      ) : stage.kind === "second-factor" ? (
        <SecondFactorStep onVerified={continueSignedIn} onBack={() => setStage({ kind: "sign-in" })} />
      ) : stage.kind === "enrol" ? (
        <MfaEnrolment onDone={continueSignedIn} onSignOut={signOut} />
      ) : stage.kind === "verify-email" ? (
        <CheckEmail email={stage.email} onBack={() => setStage({ kind: "sign-in" })} />
      ) : stage.kind === "choose" ? (
        <CompanyChooser companies={stage.companies} onOpened={enterApp} />
      ) : (
        <NoProfile onSignOut={signOut} />
      )}
    </LoginLayout>
  );
}

interface PasswordFormProps {
  notice: string | null;
  onVerifyEmail: (email: string) => void;
  onSecondFactor: () => void;
  onSignedIn: () => Promise<void>;
}

function PasswordForm({ notice, onVerifyEmail, onSecondFactor, onSignedIn }: PasswordFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await signInWithPassword(email.trim(), password);
    if (result.kind === "signed-in") {
      try {
        await onSignedIn();
        return;
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "Sign-in failed. Try again.");
      }
    } else if (result.kind === "second-factor") {
      onSecondFactor();
      return;
    } else if (result.kind === "verify-email") {
      onVerifyEmail(email.trim());
    } else {
      setError(result.message);
    }
    setPending(false);
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
      {notice ? (
        <p role="status" className="bg-brand-soft text-brand-ink rounded-md px-3 py-2 text-sm">
          {notice}
        </p>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sign-in-email">Email</Label>
        <Input
          id="sign-in-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="username"
          inputMode="email"
          className="h-10 text-base"
          autoFocus
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sign-in-password">Password</Label>
        <Input
          id="sign-in-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "sign-in-error" : undefined}
          className="h-10 text-base"
        />
      </div>
      {error ? (
        <p id="sign-in-error" role="alert" className="text-danger-ink text-sm">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending} className="h-10">
        {pending ? "Signing in" : "Sign in"}
      </Button>
    </form>
  );
}

function CheckEmail({ email, onBack }: { email: string; onBack: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-3">
        <MailCheck aria-hidden="true" className="text-brand-ink mt-0.5 size-5 shrink-0" />
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold">Check your email</h2>
          <p className="text-muted-foreground text-sm">
            We sent a link to <span className="text-foreground font-medium">{email}</span>. Open it to confirm your
            address, then sign in. The link works for one hour.
          </p>
        </div>
      </div>
      <Button variant="outline" size="lg" className="h-10 self-start" onClick={onBack}>
        Back to sign in
      </Button>
    </div>
  );
}

function CompanyChooser({ companies, onOpened }: { companies: ContextCompany[]; onOpened: () => void }) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(company: ContextCompany) {
    setPendingId(company.id);
    setError(null);
    try {
      await openCompany(company.id);
      onOpened();
    } catch (failure) {
      setPendingId(null);
      setError(failure instanceof Error ? failure.message : "That company could not be opened. Try again.");
    }
  }

  return (
    <section aria-labelledby="choose-company" className="flex flex-col gap-3">
      <h2 id="choose-company" className="text-sm font-semibold">
        Choose a company
      </h2>
      <ul className="flex flex-col gap-2">
        {companies.map((company) => (
          <li key={company.id}>
            <button
              type="button"
              onClick={() => void choose(company)}
              disabled={pendingId !== null}
              className="border-hairline hover:bg-raised flex w-full items-center justify-between gap-3 rounded-md border px-3 py-3 text-left transition-colors disabled:opacity-60"
            >
              <span className="text-sm font-medium">{company.name}</span>
              <span className="text-muted-foreground text-xs">{pendingId === company.id ? "Opening" : "Open"}</span>
            </button>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-danger-ink text-sm">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function NoProfile({ onSignOut }: { onSignOut: () => Promise<void> }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        You are signed in, but this workspace has no profile for your account yet. Ask your company&apos;s owner to add
        you, then sign in again.
      </p>
      <Button variant="outline" size="lg" className="h-10 self-start" onClick={() => void onSignOut()}>
        Sign out
      </Button>
    </div>
  );
}
