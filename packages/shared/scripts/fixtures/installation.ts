import { addDays } from "../../src/dates";
import { dec } from "../../src/money";
import type { Crew, Customer, Invoice, Job, JobStatus, Quote } from "../../src/types";
import { dueDate } from "../../src/operations/quotes";
import { jobCostFrom, laborLines } from "../../src/operations/jobs";
import type { GenContext } from "./context";
import { COLORWAYS, PHOTO_CAPTIONS } from "./vocabulary";

const SUBCONTRACTORS = ["Pinecrest Installs LLC", "Front Range Flooring Services", "Mesa Carpet Works"];
const CREW_NAMES = ["North crew", "Foothills crew", "Metro crew", "Tile crew"];
const PAST_JOBS = 25;
const TODAY_JOBS = 4;
const UPCOMING_JOBS = 11;

/** Four W-2 crews and three 1099 subcontractors (spec section 4). Installer users lead the first crews. */
export function buildCrews(ctx: GenContext, installerNames: readonly string[]): Crew[] {
  if (!ctx.company.modules.includes("installation")) return [];
  const crews: Crew[] = CREW_NAMES.map((name, i) => ({
    id: ctx.id("crew"),
    name,
    kind: "crew",
    lead: installerNames[i] ?? ctx.rng.personName(),
    members: Array.from({ length: ctx.rng.int(1, 3) }, () => ctx.rng.personName()),
    phone: ctx.rng.phone(ctx.company.areaCode),
  }));
  const subs: Crew[] = SUBCONTRACTORS.map((name) => ({
    id: ctx.id("crew"),
    name,
    kind: "subcontractor",
    lead: ctx.rng.personName(),
    members: [],
    phone: ctx.rng.phone(ctx.company.areaCode),
  }));
  return [...crews, ...subs];
}

function jobStatus(ctx: GenContext, date: string): JobStatus {
  if (date < ctx.anchor) return ctx.rng.chance(0.8) ? "signed_off" : "completed";
  if (date === ctx.anchor) return ctx.rng.chance(0.5) ? "in_progress" : "scheduled";
  return "scheduled";
}

/**
 * Job dates: 25 over the last two weeks (never before the invoice, never today), 4 today and 11
 * over the next two weeks, so the installation calendar is busy around the presenting day.
 */
function jobDate(ctx: GenContext, invoice: Invoice, index: number): string {
  if (index < PAST_JOBS) {
    const recent = addDays(ctx.anchor, -ctx.rng.int(1, 14));
    const afterInvoice = [recent, addDays(invoice.issuedAt, 1)].sort().at(-1)!;
    return [afterInvoice, addDays(ctx.anchor, -1)].sort()[0]!;
  }
  if (index < PAST_JOBS + TODAY_JOBS) return ctx.anchor;
  return addDays(ctx.anchor, ctx.rng.int(1, 13));
}

/** A crew with no job yet on that date, so no crew is booked twice in a day; any crew once all are booked. */
function freeCrew(ctx: GenContext, crews: readonly Crew[], busy: Map<string, Set<string>>, date: string): Crew {
  const taken = busy.get(date) ?? new Set<string>();
  const free = crews.filter((c) => !taken.has(c.id));
  const crew = ctx.rng.pick(free.length > 0 ? free : crews);
  busy.set(date, taken.add(crew.id));
  return crew;
}

/** Forty installation jobs from the most recent invoices that bill installation labor. */
export function buildJobs(
  ctx: GenContext,
  crews: readonly Crew[],
  invoices: readonly Invoice[],
  quotes: readonly Quote[],
  customers: readonly Customer[],
): Job[] {
  if (crews.length === 0) return [];
  const candidates = invoices
    .filter((i) => !i.isReturn && laborLines(i).length > 0)
    .sort((a, b) => a.issuedAt.localeCompare(b.issuedAt))
    .slice(-(PAST_JOBS + TODAY_JOBS + UPCOMING_JOBS));
  const busy = new Map<string, Set<string>>();
  const jobs = candidates.map((invoice, index): Job => {
    const date = jobDate(ctx, invoice, index);
    const crew = freeCrew(ctx, crews, busy, date);
    const status = jobStatus(ctx, date);
    const customer = customers.find((c) => c.id === invoice.customerId)!;
    const rooms = quotes.find((q) => q.id === invoice.quoteId)?.rooms ?? [];
    const material = invoice.lines.find((l) => l.category === "material");
    const done = status !== "scheduled";
    return {
      id: ctx.id("job"),
      number: "",
      customerId: customer.id,
      invoiceId: invoice.id,
      crewId: crew.id,
      date,
      startHour: ctx.rng.pick([7, 8, 8, 9, 12, 13]),
      durationHours: ctx.rng.int(3, 9),
      status,
      address: invoice.jobSite,
      scope: `${material?.description ?? "Installation"} in ${rooms.map((r) => r.name).join(", ") || "the home"}`,
      ...jobCostFrom(invoice, crew),
      photos: done
        ? ctx.rng
            .sample(PHOTO_CAPTIONS, ctx.rng.int(2, 4))
            .map((caption) => ({ id: ctx.id("pho"), caption, tone: ctx.rng.pick(COLORWAYS)[1] }))
        : [],
      signedOffAt: status === "signed_off" ? `${date}T16:30` : null,
      signedBy: status === "signed_off" ? customer.contactName : null,
      notes: ctx.rng.chance(0.25)
        ? ctx.rng.pick(["Gate code at front desk.", "Dog in the back yard.", "Park on the street."])
        : "",
    };
  });
  [...jobs].sort((a, b) => a.date.localeCompare(b.date)).forEach((j, i) => (j.number = `J-${4001 + i}`));
  return jobs;
}

/**
 * A deposit invoice's balance waits for its job (spec B6): until the customer signs off it has no
 * due date; after sign-off it is due under the customer's terms from that day. Returns the jobs.
 */
export function holdUntilInstalled(jobs: Job[], invoices: Invoice[], customers: readonly Customer[]): Job[] {
  for (const job of jobs) {
    const invoice = invoices.find((i) => i.id === job.invoiceId);
    if (!invoice || dec(invoice.depositPct).isZero()) continue;
    const terms = customers.find((c) => c.id === invoice.customerId)!.terms;
    invoice.dueAt = job.signedOffAt ? dueDate(job.signedOffAt.slice(0, 10), terms) : null;
  }
  return jobs;
}
