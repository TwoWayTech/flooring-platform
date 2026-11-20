"use client";

import { Download, Info, MailCheck, MailClock, MailX, Paperclip } from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { notificationEvent, type OutboxMessage, type OutboxStatus } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { NoAccess } from "@/components/no-access";
import { QueryFallback } from "@/components/query-fallback";
import { useCan } from "@/components/workspace/workspace-context";
import { downloadText } from "@/components/data-table/csv";
import { api } from "@/lib/api";
import { isDemoMode } from "@/lib/data-source";
import { useApiQuery } from "@/lib/api/use-api";
import { useFormatDate } from "@/lib/use-format-date";
import { SimulateReply } from "@/features/meetings/simulate-reply";

const STATUS: Record<
  OutboxStatus,
  { tone: "success" | "warning" | "danger" | "neutral" | "brand"; icon: typeof Info; label: string }
> = {
  // Only the demo pretends to send; in api mode the email provider sent it (ADR 0059, bell and Outbox part, D5).
  sent: { tone: "success", icon: MailCheck, label: isDemoMode() ? "Sent (simulated)" : "Sent" },
  scheduled: { tone: "brand", icon: MailClock, label: "Scheduled" },
  queued: { tone: "brand", icon: MailClock, label: "Queued" },
  sending: { tone: "brand", icon: MailClock, label: "Sending" },
  failed: { tone: "danger", icon: MailX, label: "Failed" },
  cancelled: { tone: "neutral", icon: MailX, label: "Cancelled" },
};

/** The note every Outbox view carries in the demo: nothing here is really sent (spec A4). The real API sends. */
export function OutboxBanner() {
  if (!isDemoMode()) return null;
  return (
    <p className="bg-brand-soft/40 border-hairline flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
      <Info aria-hidden="true" className="size-4 shrink-0" />
      This demo never sends real email. The Outbox shows what would have gone; the real product sends through its email
      provider.
    </p>
  );
}

function MessageDrawer({ message, all, onClose }: { message: OutboxMessage; all: boolean; onClose: () => void }) {
  const can = useCan();
  const formatDate = useFormatDate();
  const run = (work: Promise<unknown>, done: string) =>
    work
      .then(() => {
        toast.success(done);
        onClose();
      })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Not saved."));
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{message.subject}</SheetTitle>
          <SheetDescription>
            To {message.recipient.name}
            {message.recipient.email ? ` <${message.recipient.email}>` : ""}, from {message.fromName}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-6 text-sm">
          <StatusPill {...STATUS[message.status]} />
          {message.failureDetail ? (
            <p className="text-danger-ink">This could not be delivered: {message.failureDetail}.</p>
          ) : null}
          <p className="whitespace-pre-line">{message.bodyText}</p>
          {message.attachments.length ? (
            <ul className="flex flex-col gap-1.5" aria-label="Attachments">
              {message.attachments.map((a) => (
                <li key={a.fileName} className="flex items-center gap-2">
                  <Paperclip aria-hidden="true" className="size-4" />
                  {a.text ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => downloadText(a.fileName, a.text!, "text/calendar")}
                    >
                      <Download />
                      {a.fileName}
                    </Button>
                  ) : a.href ? (
                    <Link href={a.href} className="text-brand-ink underline-offset-4 hover:underline">
                      {a.fileName}
                    </Link>
                  ) : (
                    a.fileName
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-muted-foreground text-xs">Created {formatDate(message.createdAt, true)}</p>
          <div className="flex flex-wrap gap-2">
            {/* Send again and Cancel need settings.outbox.view, as on the API (ADR 0059, bell and Outbox part, D3). */}
            {message.status === "failed" && can("settings.outbox.view") ? (
              <Button variant="outline" onClick={() => void run(api.retryOutbox(message.id), "Sent again")}>
                Send again
              </Button>
            ) : null}
            {message.status === "scheduled" && can("settings.outbox.view") ? (
              <Button variant="outline" onClick={() => void run(api.cancelOutbox(message.id), "Message cancelled")}>
                Cancel message
              </Button>
            ) : null}
            {/* Presenter tools: the demo's only (D4). */}
            {isDemoMode() && message.status === "sent" && all && can("settings.outbox.view") ? (
              <Button variant="outline" onClick={() => void run(api.simulateBounce(message.id), "Marked as bounced")}>
                Simulate bounce
              </Button>
            ) : null}
            {isDemoMode() ? <SimulateReply message={message} onDone={onClose} /> : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * The Outbox (spec A4): every email the system would send, one row per recipient. `all` is the
 * admin view of the whole company; everyone else sees what they sent or received. Restricted rows
 * come back redacted from the store.
 */
export function OutboxPage({ all }: { all: boolean }) {
  const can = useCan();
  const formatDate = useFormatDate();
  const [open, setOpen] = useState<OutboxMessage | null>(null);
  const data = useApiQuery((client) => client.listOutbox(all), [all]);
  if (all && !can("settings.outbox.view")) return <NoAccess />;
  const columns: ColumnSpec<OutboxMessage>[] = [
    { id: "when", header: "When", value: (m) => m.createdAt, cell: (m) => formatDate(m.createdAt, true) },
    {
      id: "to",
      header: "To",
      value: (m) => m.recipient.name,
      cell: (m) => (
        <span className="flex flex-col">
          <span>{m.recipient.name}</span>
          <span className="text-muted-foreground text-xs">{m.recipient.email || "No email address"}</span>
        </span>
      ),
    },
    { id: "subject", header: "Subject", value: (m) => m.subject, className: "max-w-80 truncate" },
    { id: "event", header: "Event", value: (m) => notificationEvent(m.eventKey).label },
    { id: "attachments", header: "Attachments", value: (m) => m.attachments.map((a) => a.fileName).join(", ") || null },
    {
      id: "status",
      header: "Status",
      filter: "select",
      value: (m) => STATUS[m.status].label,
      cell: (m) => <StatusPill {...STATUS[m.status]} />,
    },
  ];
  return (
    <>
      {all ? null : (
        <PageHeader
          title="Outbox"
          description="Emails sent by you or to you, with who they went to and their status."
        />
      )}
      <div className="flex flex-col gap-4">
        <OutboxBanner />
        {data.status !== "ready" ? (
          <QueryFallback query={data} className="h-96" label="Loading outbox" />
        ) : (
          <DataTable
            id={all ? "outbox-all" : "outbox-mine"}
            rows={data.data}
            columns={columns}
            getRowId={(m) => m.id}
            onRowClick={setOpen}
            empty={{
              message: "Nothing has been sent yet. Emails appear here when a quote, invoice or meeting goes out.",
            }}
          />
        )}
      </div>
      {open ? <MessageDrawer message={open} all={all} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
