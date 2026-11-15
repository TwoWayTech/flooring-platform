"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { Ban, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { SUPPORT_READ_ONLY_MESSAGE, supportActions, type CompanySupportGrant } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { QueryFallback } from "@/components/query-fallback";
import { StepUpDialog } from "@/components/step-up-dialog";
import { SUPPORT_STATUS, SupportGrantStatusPill } from "@/features/admin/support-grant-status";
import { useStanding } from "@/features/standing/standing-context";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api/errors";
import { useApiQuery } from "@/lib/api/use-api";
import { useFormatDate } from "@/lib/use-format-date";

const DESCRIPTION =
  "Our support team can ask to see your company's data, read only, for a few hours. Nothing opens unless you approve, and you can end an approval early. Approving doesn't open your data yet: support can't see your company's data in this version.";

/** The panel's heading, what support access is, and why nothing can change while the company is read only. */
function SupportAccessFrame({
  readOnly,
  headingRef,
  children,
}: {
  readOnly: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby="support-access-title" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="support-access-title" ref={headingRef} tabIndex={-1} className="text-base font-semibold outline-none">
          Support access
        </h2>
        <p className="text-muted-foreground max-w-prose text-sm">{DESCRIPTION}</p>
      </div>
      {readOnly ? (
        <p role="note" className="bg-warning/14 text-warning-ink max-w-prose rounded-md px-3 py-2 text-sm">
          {SUPPORT_READ_ONLY_MESSAGE}
        </p>
      ) : null}
      {children}
    </section>
  );
}

interface SupportAccessViewProps {
  grants: CompanySupportGrant[];
  /** The company is read only: the API refuses every decision, so none is offered. */
  readOnly: boolean;
  onApprove: (grant: CompanySupportGrant) => void;
  onRevoke: (grant: CompanySupportGrant) => void;
  /** The heading, which takes focus when a decision removed the button that opened its dialog. */
  headingRef?: Ref<HTMLHeadingElement>;
}

/**
 * The Owner's support-access requests (docs/specs/platform-admin.md, part 4, "Support access"):
 * when each was asked for, by whom, why, until when and its status, with the decisions
 * `supportActions` allows. No CSV export, because reasons are free text. While the company is read
 * only, the actions are hidden and a note says why, rather than offered only to fail (ADR 0054).
 */
export function SupportAccessView({ grants, readOnly, onApprove, onRevoke, headingRef }: SupportAccessViewProps) {
  const formatDate = useFormatDate();
  const columns = useMemo<ColumnSpec<CompanySupportGrant>[]>(
    () => [
      {
        id: "requested",
        header: "Requested",
        value: (g) => g.requestedAt,
        cell: (g) => formatDate(g.requestedAt, true),
      },
      { id: "by", header: "By", value: (g) => g.adminName },
      { id: "reason", header: "Reason", value: (g) => g.reason, className: "min-w-48 max-w-sm whitespace-normal" },
      { id: "ends", header: "Ends", value: (g) => g.expiresAt, cell: (g) => formatDate(g.expiresAt, true) },
      {
        id: "status",
        header: "Status",
        value: (g) => SUPPORT_STATUS[g.status].label,
        cell: (g) => <SupportGrantStatusPill status={g.status} />,
      },
      {
        id: "actions",
        header: "Actions",
        visualOnly: true,
        value: () => null,
        cell: (g) => {
          const actions = supportActions(g.status, readOnly);
          if (actions.length === 0) return null;
          return (
            <span className="flex flex-wrap gap-2">
              {actions.includes("approve") ? (
                <Button size="sm" onClick={() => onApprove(g)} aria-label={`Approve support access for ${g.adminName}`}>
                  <ShieldCheck aria-hidden="true" />
                  Approve
                </Button>
              ) : null}
              {actions.includes("revoke") ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onRevoke(g)}
                  aria-label={`Revoke support access for ${g.adminName}`}
                >
                  <Ban aria-hidden="true" />
                  Revoke
                </Button>
              ) : null}
            </span>
          );
        },
      },
    ],
    [formatDate, readOnly, onApprove, onRevoke],
  );
  return (
    <SupportAccessFrame readOnly={readOnly} headingRef={headingRef}>
      <DataTable
        id="settings-support-access"
        rows={grants}
        columns={columns}
        getRowId={(g) => g.id}
        searchPlaceholder="Search requests"
        initialSort={{ id: "requested", desc: true }}
        empty={{ message: "No support requests yet." }}
      />
    </SupportAccessFrame>
  );
}

/**
 * Settings → Users → Support access, the Owner's only (spec part 4). Approving asks for a step-up,
 * as the API does; revoking asks only to confirm, because the API asks for no step-up. A refused
 * decision shows the API's words in a toast; either way the list is read again. Support can't see
 * the company's data in this version, whatever is approved (owner question 2).
 */
export function SupportAccessPanel() {
  const formatDate = useFormatDate();
  const { standing } = useStanding();
  const readOnly = standing?.state === "read_only";
  // Bumped after each decision so the list is read again in place, keeping the table on screen.
  const [decisions, setDecisions] = useState(0);
  const query = useApiQuery((client) => client.listSupportGrants(), [decisions]);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (decisions === 0) return;
    // A decision can remove the button that opened its dialog; once the dialog has closed, focus
    // that would fall to the page lands on the panel's heading instead.
    const timer = setTimeout(() => {
      if (document.activeElement === document.body) heading.current?.focus();
    }, 250);
    return () => clearTimeout(timer);
  }, [decisions, query.data]);
  const [approving, setApproving] = useState<CompanySupportGrant | null>(null);
  const [revoking, setRevoking] = useState<CompanySupportGrant | null>(null);
  const [pending, setPending] = useState(false);

  /** Sends one decision; a refusal (409 or a read-only company) is shown, and the list is read again. */
  async function decide(grant: CompanySupportGrant, step: "approve" | "revoke") {
    try {
      if (step === "approve") {
        await api.approveSupportGrant(grant.id);
        toast.success(
          `Support access approved. It ends ${formatDate(grant.expiresAt, true)}. Support can't see your data yet.`,
        );
      } else {
        await api.revokeSupportGrant(grant.id);
        toast.success("Support access revoked.");
      }
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      toast.error(failure.message);
    }
    setDecisions((n) => n + 1);
  }

  async function revoke(grant: CompanySupportGrant) {
    setPending(true);
    try {
      await decide(grant, "revoke");
    } finally {
      setPending(false);
      setRevoking(null);
    }
  }

  if (query.status !== "ready") {
    return (
      <SupportAccessFrame readOnly={readOnly}>
        <QueryFallback query={query} className="h-48" label="Loading support access" />
      </SupportAccessFrame>
    );
  }
  return (
    <>
      <SupportAccessView
        grants={query.data}
        readOnly={readOnly}
        onApprove={setApproving}
        onRevoke={setRevoking}
        headingRef={heading}
      />
      <StepUpDialog
        open={!!approving}
        action={approving ? `Approving support access for ${approving.adminName}` : ""}
        onOpenChange={(open) => !open && setApproving(null)}
        onConfirm={async () => {
          if (approving) await decide(approving, "approve");
          setApproving(null);
        }}
      />
      <Dialog open={!!revoking} onOpenChange={(open) => !open && setRevoking(null)}>
        <DialogContent className="bg-surface sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Revoke support access?</DialogTitle>
            <DialogDescription>{revoking ? `${revoking.adminName} loses this access at once.` : ""}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevoking(null)}>
              Keep
            </Button>
            <Button onClick={() => revoking && void revoke(revoking)} disabled={pending}>
              Revoke access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
