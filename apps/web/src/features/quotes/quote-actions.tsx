"use client";

import { CircleCheck, FileText, Save, Send, TriangleAlert, XCircle } from "lucide-react";
import { REPRICE_ACCEPTED_WARNING, type QuoteAction } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";

interface QuoteActionsProps {
  /** The quote is still a draft, so saving keeps it one. */
  isDraft: boolean;
  dirty: boolean;
  /** A request is in flight: every button is disabled, so nothing is sent twice. */
  pending: boolean;
  /** The unsaved changes reprice an accepted quote, so saving sends it back to Pending. */
  repricing: boolean;
  /** Status changes allowed in the quote's state (quoteActions). */
  actions: QuoteAction[];
  canConvert: boolean;
  onSave: () => void;
  onAction: (action: QuoteAction) => void;
  onConvert: () => void;
}

/**
 * The quote's buttons (spec B1): Save as draft at every point, Send / mark pending, Accept or
 * Decline once sent, and Convert to invoice. Send and Convert validate the whole quote first.
 * Before a save that reprices an accepted quote it warns that the quote goes back to Pending
 * (ADR 0061, decision 7).
 */
export function QuoteActions({
  isDraft,
  dirty,
  pending,
  repricing,
  actions,
  canConvert,
  onSave,
  onAction,
  onConvert,
}: QuoteActionsProps) {
  return (
    <>
      {dirty ? <p className="text-muted-foreground text-xs">Unsaved changes</p> : null}
      {repricing ? (
        <p
          role="status"
          id="quote-reprice-warning"
          className="bg-warning/14 text-warning-ink flex items-start gap-2 rounded-md px-3 py-2 text-xs"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {REPRICE_ACCEPTED_WARNING}
        </p>
      ) : null}
      <Button
        variant="outline"
        onClick={onSave}
        disabled={pending}
        aria-describedby={repricing ? "quote-reprice-warning" : undefined}
      >
        <Save />
        {isDraft ? "Save as draft" : "Save quote"}
      </Button>
      {actions.includes("send") ? (
        <Button variant={canConvert ? "outline" : "default"} onClick={() => onAction("send")} disabled={pending}>
          <Send />
          Send / mark pending
        </Button>
      ) : null}
      {actions.includes("accept") || actions.includes("decline") ? (
        <div className="grid grid-cols-2 gap-2">
          {actions.includes("accept") ? (
            <Button variant="outline" onClick={() => onAction("accept")} disabled={pending}>
              <CircleCheck />
              Mark accepted
            </Button>
          ) : null}
          {actions.includes("decline") ? (
            <Button variant="outline" onClick={() => onAction("decline")} disabled={pending}>
              <XCircle />
              Mark declined
            </Button>
          ) : null}
        </div>
      ) : null}
      {canConvert ? (
        <Button onClick={onConvert} disabled={pending}>
          <FileText />
          Convert to invoice
        </Button>
      ) : null}
    </>
  );
}
