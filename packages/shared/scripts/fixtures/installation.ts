import { addDays } from "../../src/dates";
import { dec, moneyString, roundMoney } from "../../src/money";
import type { Crew, Customer, Invoice, Job, JobStatus, Quote } from "../../src/types";
import type { GenContext } from "./context";
import { COLORWAYS, PHOTO_CAPTIONS } from "./vocabulary";

const SUBCONTRACTORS = ["Pinecrest Installs LLC", "Front Range Flooring Services", "Mesa Carpet Works"];
const CREW_NAMES = ["North crew", "Foothills crew", "Metro crew", "Tile crew"];
/** Loaded hourly cost of a W-2 crew; subcontractors charge 62 % of the labor billed instead. */
const CREW_HOURLY_COST = "38.00";
const SUB_SHARE_OF_LABOR = "0.62";
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

/** Labor billed on an invoice: the lines taxed as installation labor. */
function laborLines(invoice: Invoice) {
  return invoice.lines.filter((l) => l.category === "labor");
}

function jobStatus(ctx: GenContext, date: string): JobStatus {
  if (date < ctx.anchor) return ctx.rng.chance(0.8) ? "signed_off" : "completed";
  if (date === ctx.anchor) return ctx.rng.chance(0.5) ? "in_progress" : "scheduled";
  return "scheduled";
}

/** Job dates: 25 in the past, 4 today and 11 over the next two weeks, oldest invoice first. */
function jobDate(ctx: GenContext, invoice: Invoice, index: number): string {
  if (index < PAST_JOBS) return [addDays(invoice.issuedAt, ctx.rng.int(2, 10)), addDays(ctx.anchor, -1)].sort()[0]!;
  if (index < PAST_JOBS + TODAY_JOBS) return ctx.anchor;
  return addDays(ctx.anchor, ctx.rng.int(1, 13));
}

/**
 * Job costing (spec "Installation"): materials at the invoice's unit cost, labor at crew hours
 * or the subcontractor's share, revenue as the invoice subtotal. Margin is derived, not stored.
 */
function costJob(invoice: Invoice, crew: Crew) {
  const labor = laborLines(invoice);
  const installSqFt = labor.filter((l) => l.unit === "sq_ft").reduce((s, l) => s.plus(l.quantity), dec(0));
  const laborHours = installSqFt.dividedBy(100).times("2.2").plus(2).toDecimalPlaces(1);
  const billedLabor = labor.reduce((s, l) => s.plus(roundMoney(dec(l.quantity).times(l.unitPrice))), dec(0));
  const laborCost = crew.kind === "crew" ? laborHours.times(CREW_HOURLY_COST) : billedLabor.times(SUB_SHARE_OF_LABOR);
  return {
    materials: invoice.lines
      .filter((l) => l.category === "material")
      .map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        cost: moneyString(dec(l.quantity).times(l.unitCost)),
      })),
    laborHours: laborHours.toString(),
    laborCost: moneyString(laborCost),
    revenue: invoice.subtotal,
  };
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
  const jobs = candidates.map((invoice, index): Job => {
    const crew = ctx.rng.pick(crews);
    const date = jobDate(ctx, invoice, index);
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
      ...costJob(invoice, crew),
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
