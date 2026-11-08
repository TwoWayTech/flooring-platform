"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileText, Save } from "lucide-react";
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
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Panel } from "@workspace/ui/components/panel";
import { api } from "@/lib/api";
import { QuoteStatusPill } from "@/lib/document-status";
import { useFormatDate } from "@/lib/use-format-date";
import { useCan } from "@/components/workspace/workspace-context";
import { LinesEditor } from "./lines-editor";
import { QuoteHeader } from "./quote-header";
import { QuoteSummary } from "./quote-summary";
import { RoomCanvas } from "./room-canvas";
import { RoomsList } from "./rooms-list";
import { useQuoteDraft } from "./use-quote-draft";

const localId = (kind: string) => `${kind}-${crypto.randomUUID().slice(0, 8)}`;

/**
 * A blank quote for the signed-in rep, with the company's default deposit and home state, fulfilled
 * from the rep's default warehouse (spec A1).
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

interface QuoteBuilderProps {
  initial: Quote;
  products: Product[];
  customers: Customer[];
  settings: CompanySettings;
  locations: Location[];
}

/**
 * The quote builder (spec "Quote builder → invoice", design brief wireframe): rooms on a canvas,
 * lines measured from them, tax by job-site state, deposit, and Convert to invoice. Totals come
 * from the shared decimal calculator, the same one that invoices and the PDF use.
 */
export function QuoteBuilder({ initial, products, customers, settings, locations }: QuoteBuilderProps) {
  const router = useRouter();
  const can = useCan();
  const formatDate = useFormatDate();
  const [draft, dispatch] = useQuoteDraft(initial, products);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [savedDraft, setSavedDraft] = useState(initial);

  const editable = !draft.invoiceId && can(draft.number ? "sales.quote.edit" : "sales.quote.create");
  const customer = customers.find((c) => c.id === draft.customerId);
  const ctx = taxContextFor(
    settings.localization,
    draft.jobSite,
    customer ?? { taxExempt: false, certificate: null },
    api.today(),
    draft.lumpSum,
    draft.taxOverride,
  );
  const totals = computeTotals(draft.lines, ctx);
  const dirty = draft !== savedDraft;

  async function save(): Promise<Quote | null> {
    if (!customer) {
      toast.error("Choose a customer before saving the quote.");
      return null;
    }
    const saved = await api.saveQuote({ ...draft, total: totals.total });
    setSavedDraft(draft);
    toast.success(`Quote ${saved.number} saved`);
    if (!draft.id) router.replace(`/sales/quotes/${saved.id}`);
    return saved;
  }

  async function convert() {
    setPending(true);
    try {
      const saved = dirty || !draft.id ? await save() : draft;
      if (!saved) return;
      const invoice = await api.convertQuoteToInvoice(saved.id);
      toast.success(`Invoice ${invoice.number} created`);
      router.push(`/sales/invoices/${invoice.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The invoice was not created. Try again.");
    } finally {
      setPending(false);
    }
  }

  const measure = can("retail.room.measure");
  return (
    <>
      <PageHeader
        title={draft.number ? `Quote ${draft.number}` : "New quote"}
        description={
          <span className="flex flex-wrap items-center gap-3">
            <QuoteStatusPill status={draft.status} />
            <span>Created {formatDate(draft.createdAt)}</span>
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
          onCustomer={(c) => dispatch({ type: "customer", customerId: c.id, jobSite: { ...c.address } })}
          onJobSite={(jobSite) => dispatch({ type: "jobSite", jobSite })}
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
                <>
                  {dirty ? <p className="text-muted-foreground text-xs">Unsaved changes</p> : null}
                  <Button variant="outline" onClick={() => void save()} disabled={pending}>
                    <Save />
                    Save quote
                  </Button>
                  {can("sales.invoice.create") && featureOn("sales.invoices") ? (
                    <Button onClick={() => void convert()} disabled={pending || draft.lines.length === 0}>
                      <FileText />
                      Convert to invoice
                    </Button>
                  ) : null}
                </>
              ) : null
            }
          />
        </Panel>
      </div>
    </>
  );
}
