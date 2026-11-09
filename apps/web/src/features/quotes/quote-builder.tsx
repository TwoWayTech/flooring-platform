"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import {
  featureOn,
  computeTotals,
  taxContextFor,
  type CompanySettings,
  type Customer,
  type Location,
  type Product,
  type Quote,
  type Room,
  type User,
  defaultAddress,
  defaultQuoteExpiry,
  plainAddress,
  quoteActions,
  quoteDraftProblem,
  quoteIsOpen,
  quoteSendProblems,
  quoteState,
  QUOTE_STATE_LABELS,
  type QuoteAction,
  type QuoteField,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Panel } from "@workspace/ui/components/panel";
import { api } from "@/lib/api";
import { QuoteStatusPill } from "@/lib/document-status";
import { useFormatDate } from "@/lib/use-format-date";
import { useCan } from "@/components/workspace/workspace-context";
import { LinesEditor } from "./lines-editor";
import { QuoteActions } from "./quote-actions";
import { QUOTE_FIELD_IDS, QuoteHeader } from "./quote-header";
import { QuoteSummary } from "./quote-summary";
import { RoomCanvas } from "./room-canvas";
import { RoomsList } from "./rooms-list";
import { SendQuoteDialog } from "./send-quote-dialog";
import { useQuoteDraft } from "./use-quote-draft";

const localId = (kind: string) => `${kind}-${crypto.randomUUID().slice(0, 8)}`;
const message = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/**
 * A blank quote for the signed-in rep, with the company's default deposit and home state, fulfilled
 * from the rep's default warehouse (spec A1). It starts as a Draft (spec B1).
 */
export function newQuote(user: User, settings: CompanySettings, today: string, locationId: string): Quote {
  return {
    id: "",
    number: "",
    customerId: "",
    salesRepId: user.id,
    branchId: user.branchId,
    status: "draft",
    createdAt: today,
    sentAt: null,
    expiresAt: null,
    locationId,
    jobSite: { street: "", city: "", state: settings.localization.region.primaryState, zip: "" },
    rooms: [],
    lines: [],
    depositPct: settings.localization.documents.defaultDepositPct,
    lumpSum: false,
    taxOverride: null,
    invoiceId: null,
    total: "0.00",
    notes: "",
  };
}

/** Where a new default room goes: the next free spot along the top row of the canvas. */
function nextRoomSpot(rooms: readonly Room[]): Pick<Room, "x" | "y"> {
  const right = rooms.reduce((max, r) => Math.max(max, r.x + r.widthFt), -2);
  return right + 14 <= 48 ? { x: right + 2, y: 0 } : { x: 0, y: 16 };
}

/** Moves focus to the first field with a problem, in the order the form shows them (spec quality floor). */
function focusFirst(fields: readonly QuoteField[]) {
  const first = (Object.keys(QUOTE_FIELD_IDS) as QuoteField[]).find((f) => fields.includes(f));
  if (first) requestAnimationFrame(() => document.getElementById(QUOTE_FIELD_IDS[first])?.focus());
}

interface QuoteBuilderProps {
  initial: Quote;
  products: Product[];
  customers: Customer[];
  settings: CompanySettings;
  locations: Location[];
}

/**
 * The quote builder (spec "Quote builder → invoice", B1, design brief wireframe): rooms on a
 * canvas, lines measured from them, tax by job-site state, deposit, and the quote's status: Save as
 * draft at any point, Send / mark pending, Accept, Decline and Convert to invoice. Sending and
 * converting validate the whole quote first. Totals come from the shared decimal calculator, the
 * same one that invoices and the PDF use.
 */
export function QuoteBuilder({ initial, products, customers, settings, locations }: QuoteBuilderProps) {
  const router = useRouter();
  const can = useCan();
  const formatDate = useFormatDate();
  const [draft, dispatch] = useQuoteDraft(initial, products);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [savedDraft, setSavedDraft] = useState(initial);
  const [attempted, setAttempted] = useState(false);
  const [sending, setSending] = useState(false);
  const today = api.today();

  const editable = quoteIsOpen(draft) && can(draft.number ? "sales.quote.edit" : "sales.quote.create");
  const state = quoteState(draft, today);
  const problems = attempted ? quoteSendProblems(draft, null, today) : {};
  const customer = customers.find((c) => c.id === draft.customerId);
  const ctx = taxContextFor(
    settings.localization,
    draft.jobSite,
    customer ?? { taxExempt: false, certificate: null },
    today,
    draft.lumpSum,
    draft.taxOverride,
  );
  const totals = computeTotals(draft.lines, ctx);
  const dirty = draft !== savedDraft;

  /** Full validation before sending or converting; shows each problem next to its field. */
  function validate(): boolean {
    const found = Object.keys(quoteSendProblems(draft, null, today)) as QuoteField[];
    setAttempted(true);
    if (found.length === 0) return true;
    focusFirst(found);
    toast.error("Complete the highlighted fields first.");
    return false;
  }

  /** Saves the quote (a new one as a Draft); a caller that goes on to another step navigates itself. */
  async function save({ navigate = true } = {}): Promise<Quote | null> {
    const problem = quoteDraftProblem(draft);
    if (problem) {
      toast.error(problem);
      focusFirst(["customer"]);
      return null;
    }
    const saved = await api.saveQuote({ ...draft, total: totals.total });
    dispatch({ type: "saved", quote: saved });
    setSavedDraft(saved);
    toast.success(`Quote ${saved.number} saved`);
    if (!draft.id && navigate) router.replace(`/sales/quotes/${saved.id}`);
    return saved;
  }

  /** Runs a step on the saved quote, saving unsaved changes first; a failure becomes a toast. */
  async function withSaved(step: (saved: Quote) => Promise<void>, failure: string) {
    setPending(true);
    try {
      const saved = dirty || !draft.id ? await save({ navigate: false }) : draft;
      if (saved) await step(saved);
    } catch (error) {
      toast.error(message(error, failure));
    } finally {
      setPending(false);
    }
  }

  function changeStatus(action: QuoteAction, expiresAt?: string | null) {
    void withSaved(async (saved) => {
      const updated = await api.updateQuoteStatus(saved.id, { action, expiresAt });
      dispatch({ type: "saved", quote: updated });
      setSavedDraft(updated);
      setSending(false);
      toast.success(`Quote ${updated.number} marked ${QUOTE_STATE_LABELS[quoteState(updated, today)].toLowerCase()}`);
      if (!draft.id) router.replace(`/sales/quotes/${updated.id}`);
    }, "The quote was not updated. Try again.");
  }

  function convert() {
    if (!validate()) return;
    void withSaved(async (saved) => {
      const invoice = await api.convertQuoteToInvoice(saved.id);
      toast.success(`Invoice ${invoice.number} created`);
      router.push(`/sales/invoices/${invoice.id}`);
    }, "The invoice was not created. Try again.");
  }

  const measure = can("retail.room.measure");
  return (
    <>
      <PageHeader
        title={draft.number ? `Quote ${draft.number}` : "New quote"}
        description={
          <span className="flex flex-wrap items-center gap-3">
            <QuoteStatusPill state={state} />
            <span>Created {formatDate(draft.createdAt)}</span>
            {draft.sentAt ? <span>Sent {formatDate(draft.sentAt)}</span> : null}
            {draft.expiresAt && draft.status === "pending" ? (
              <span>
                {state === "expired" ? "Expired" : "Valid until"} {formatDate(draft.expiresAt)}
              </span>
            ) : null}
          </span>
        }
        actions={
          draft.invoiceId && featureOn("sales.invoices") ? (
            <Button asChild variant="outline">
              <Link href={`/sales/invoices/${draft.invoiceId}`}>
                <FileText />
                View invoice
              </Link>
            </Button>
          ) : null
        }
      />
      <Panel>
        <QuoteHeader
          customers={customers}
          customerId={draft.customerId}
          jobSite={draft.jobSite}
          locations={locations}
          locationId={draft.locationId}
          onLocation={(locationId) => dispatch({ type: "location", locationId })}
          editable={editable}
          taxedStates={settings.localization.tax.rules.map((r) => r.state)}
          onCustomer={(c) =>
            dispatch({
              type: "customer",
              customerId: c.id,
              jobSite: c.addresses.length ? plainAddress(defaultAddress(c, "job_site")) : draft.jobSite,
            })
          }
          onJobSite={(jobSite) => dispatch({ type: "jobSite", jobSite })}
          problems={problems}
        />
      </Panel>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          {measure ? (
            <Panel title="Rooms" bodyClassName="flex flex-col gap-4">
              <div className="border-hairline relative overflow-hidden rounded-md border">
                {draft.rooms.length === 0 && editable ? (
                  <p className="text-muted-foreground pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm">
                    Drag on the floor plan to draw a room, or use Add room.
                  </p>
                ) : null}
                <RoomCanvas
                  rooms={draft.rooms}
                  selectedId={selectedRoom}
                  editable={editable}
                  onSelect={setSelectedRoom}
                  onAdd={(shape) => {
                    const room = { ...shape, id: localId("room"), name: `Room ${draft.rooms.length + 1}` };
                    dispatch({ type: "addRoom", room });
                    setSelectedRoom(room.id);
                  }}
                  onChange={(room) => dispatch({ type: "updateRoom", room })}
                />
              </div>
              <RoomsList
                rooms={draft.rooms}
                selectedId={selectedRoom}
                editable={editable}
                onSelect={setSelectedRoom}
                onChange={(room) => dispatch({ type: "updateRoom", room })}
                onRemove={(roomId) => dispatch({ type: "removeRoom", roomId })}
                onAddDefault={() =>
                  dispatch({
                    type: "addRoom",
                    room: {
                      id: localId("room"),
                      name: `Room ${draft.rooms.length + 1}`,
                      widthFt: 12,
                      lengthFt: 12,
                      ...nextRoomSpot(draft.rooms),
                    },
                  })
                }
              />
            </Panel>
          ) : null}
          <Panel title="Lines">
            <LinesEditor
              lines={draft.lines}
              rooms={draft.rooms}
              products={products}
              totals={totals}
              editable={editable}
              onAdd={(product) => dispatch({ type: "addProduct", product, lineId: localId("ln") })}
              onChange={(line) => dispatch({ type: "updateLine", line })}
              onRemove={(lineId) => dispatch({ type: "removeLine", lineId })}
              error={problems.lines}
            />
          </Panel>
        </div>
        <Panel title="Summary" className="lg:sticky lg:top-4">
          <QuoteSummary
            totals={totals}
            ctx={ctx}
            override={draft.taxOverride}
            canOverride={editable && can("sales.tax.override")}
            onOverride={(override) => dispatch({ type: "taxOverride", override })}
            state={draft.jobSite.state}
            depositPct={draft.depositPct}
            editable={editable}
            onDeposit={(depositPct) => dispatch({ type: "deposit", depositPct })}
            actions={
              editable ? (
                <QuoteActions
                  isDraft={draft.status === "draft"}
                  dirty={dirty}
                  pending={pending}
                  actions={draft.number && !can("sales.quote.edit") ? [] : quoteActions(draft, today)}
                  canConvert={can("sales.invoice.create") && featureOn("sales.invoices")}
                  onSave={() => void save().catch((e: unknown) => toast.error(message(e, "Not saved. Try again.")))}
                  onAction={(action) => {
                    if (action !== "send") return changeStatus(action);
                    if (validate()) setSending(true);
                  }}
                  onConvert={convert}
                />
              ) : null
            }
          />
        </Panel>
      </div>
      {sending ? (
        <SendQuoteDialog
          today={today}
          defaultExpiry={defaultQuoteExpiry(today, settings.localization.documents.quoteExpiryDays)}
          pending={pending}
          onOpenChange={setSending}
          onSend={(expiresAt) => changeStatus("send", expiresAt)}
        />
      ) : null}
    </>
  );
}
