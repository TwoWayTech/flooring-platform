"use client";

import { useState } from "react";
import { CircleCheck, CircleDashed, Fingerprint, KeyRound, Plus } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Panel } from "@workspace/ui/components/panel";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { QueryFallback } from "@/components/query-fallback";
import { useApiQuery } from "@/lib/api/use-api";
import { isDemoMode } from "@/lib/data-source";
import { useFormatDate } from "@/lib/use-format-date";
import { useHydrated } from "@/lib/use-hydrated";
import type { PasskeySummary, SignInSecurity } from "@/lib/session/passkeys";
import { passkeysSupported } from "@/lib/session/webauthn";
import { AddPasskeyDialog, RemovePasskeyDialog, RenamePasskeyDialog } from "./passkey-dialogs";

/**
 * Sign-in and security (ADR 0060): where the signed-in person stands on two-step sign-in, and
 * their passkeys, with Add, Rename and Remove. Every person can open it, in both products; it is
 * about their own account, so it needs no permission key.
 */
export function SecurityPage() {
  const query = useApiQuery((client) => client.signInSecurity(), []);
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Sign-in and security" description="How you confirm it is you when you sign in." />
      {query.status === "ready" ? (
        <>
          <TwoStepPanel security={query.data} />
          <PasskeysPanel security={query.data} />
        </>
      ) : (
        <QueryFallback query={query} className="h-64" label="Loading sign-in and security" />
      )}
    </div>
  );
}

function TwoStepPanel({ security }: { security: SignInSecurity }) {
  const on = security.totp || security.passkeys.length > 0;
  return (
    <Panel title="Two-step sign-in">
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[12rem_1fr]">
        <dt className="text-muted-foreground">Status</dt>
        <dd>
          {on ? (
            <StatusPill tone="success" icon={CircleCheck} label="On" />
          ) : (
            <StatusPill tone="neutral" icon={CircleDashed} label="Off" />
          )}
          <span className="text-muted-foreground ml-2">
            {security.mfaRequired ? "Your role requires it." : "Your role does not require it."}
          </span>
        </dd>
        <dt className="text-muted-foreground">Authenticator app</dt>
        <dd>{security.totp ? "Set up" : "Not set up"}</dd>
        <dt className="text-muted-foreground">Passkeys</dt>
        <dd>{security.passkeys.length === 0 ? "None" : security.passkeys.length}</dd>
      </dl>
    </Panel>
  );
}

type Editing = { kind: "rename" | "remove"; passkey: PasskeySummary } | null;

function PasskeysPanel({ security }: { security: SignInSecurity }) {
  const hydrated = useHydrated();
  const supported = !hydrated || isDemoMode() || passkeysSupported();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const onlyFactor = security.mfaRequired && !security.totp && security.passkeys.length === 1;

  return (
    <Panel
      title="Passkeys"
      bodyClassName="p-0"
      actions={
        <Button size="sm" onClick={() => setAdding(true)} disabled={!supported}>
          <Plus />
          Add a passkey
        </Button>
      }
    >
      <p className="text-muted-foreground border-hairline border-b px-4 py-3 text-sm">
        A passkey signs you in with your fingerprint, face or device PIN, with no password or code to type.
        {!supported ? " This browser cannot use passkeys; open the app in an up-to-date browser to add one." : null}
      </p>
      {security.passkeys.length === 0 ? (
        <p className="text-muted-foreground px-4 py-6 text-sm">No passkeys yet. Add a passkey to sign in faster.</p>
      ) : (
        <ul aria-label="Your passkeys" className="divide-hairline divide-y">
          {security.passkeys.map((passkey) => (
            <PasskeyRow
              key={passkey.id}
              passkey={passkey}
              onRename={() => setEditing({ kind: "rename", passkey })}
              onRemove={() => setEditing({ kind: "remove", passkey })}
            />
          ))}
        </ul>
      )}
      {onlyFactor ? (
        <p className="text-muted-foreground border-hairline border-t px-4 py-3 text-xs">
          This passkey is how you sign in. Add another before you remove it.
        </p>
      ) : null}
      <AddPasskeyDialog open={adding} onOpenChange={setAdding} />
      {editing?.kind === "rename" ? (
        <RenamePasskeyDialog passkey={editing.passkey} onOpenChange={() => setEditing(null)} />
      ) : null}
      {editing?.kind === "remove" ? (
        <RemovePasskeyDialog passkey={editing.passkey} onOpenChange={() => setEditing(null)} />
      ) : null}
    </Panel>
  );
}

function PasskeyRow({
  passkey,
  onRename,
  onRemove,
}: {
  passkey: PasskeySummary;
  onRename: () => void;
  onRemove: () => void;
}) {
  const formatDate = useFormatDate();
  const Icon = passkey.synced ? KeyRound : Fingerprint;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <Icon aria-hidden="true" className="text-brand-ink size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{passkey.name}</p>
        <p className="text-muted-foreground text-xs">
          {passkey.createdAt ? `Added ${formatDate(passkey.createdAt)}. ` : null}
          {passkey.synced ? "Syncs across your devices." : "Stays on one device or security key."}
        </p>
      </div>
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" onClick={onRename} aria-label={`Rename ${passkey.name}`}>
          Rename
        </Button>
        <Button variant="ghost" size="sm" onClick={onRemove} aria-label={`Remove ${passkey.name}`}>
          Remove
        </Button>
      </div>
    </li>
  );
}
