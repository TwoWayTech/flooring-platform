"use client";

import { CircleCheck, FileText, Save, Send, XCircle } from "lucide-react";
import type { QuoteAction } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";

interface QuoteActionsProps {
  /** The quote is still a draft, so saving keeps it one. */
  isDraft: boolean;
  dirty: boolean;
  pending: boolean;
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
 */
export function QuoteActions({
  isDraft,
  dirty,
  pending,
  actions,
  canConvert,
  onSave,
  onAction,
  onConvert,
}: QuoteActionsProps) {
  return (
    <>
      {dirty ? <p className="text-muted-foreground text-xs">Unsaved changes</p> : null}
      <Button variant="outline" onClick={onSave} disabled={pending}>
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
