import { addDays } from "../../src/dates";
import { lineAmount } from "../../src/documents";
import { jobCostFrom } from "../../src/operations/jobs";
import { dec, moneyString, sum } from "../../src/money";
import { adjustmentNeedsApproval } from "../../src/reservations";
import { boxedOnHand } from "../../src/stock";
import type { CompanyFixtures, Job, StockAdjustment, StockMovement, User } from "../../src/types";
import type { GenContext } from "./context";

/**
 * A job installed from an accepted quote whose invoice is not made yet (spec B6 "Create invoice
 * from this job"): signed off two days ago by the first W-2 crew.
 */
function unbilledJob(ctx: GenContext, f: CompanyFixtures): Job[] {
  const quote = f.quotes.find((q) => q.status === "accepted" && q.lines.some((l) => l.category === "labor"));
  const crew = f.crews.find((c) => c.kind === "crew");
  if (!quote || !crew) return [];
  const customer = f.customers.find((c) => c.id === quote.customerId)!;
  const date = addDays(ctx.anchor, -2);
  const material = quote.lines.find((l) => l.category === "material");
  return [
    {
      id: ctx.id("job"),
      number: `J-${4001 + f.jobs.length}`,
      customerId: customer.id,
      invoiceId: null,
      crewId: crew.id,
      date,
      startHour: 8,
      durationHours: 6,
      status: "signed_off",
      address: quote.jobSite,
      scope: `${material?.description ?? "Installation"} in ${quote.rooms.map((r) => r.name).join(", ") || "the home"}`,
      ...jobCostFrom({ lines: quote.lines, subtotal: moneyString(sum(quote.lines.map(lineAmount))) }, crew),
      photos: [],
      signedOffAt: `${date}T15:45`,
      signedBy: customer.contactName,
      notes: "Installed from the accepted quote; the invoice is not made yet.",
    },
  ];
}

/** Stock free at a warehouse, in sq ft: on hand less what active reservations hold. */
function freeStock(f: CompanyFixtures, productId: string, locationId: string) {
  const held = sum(
    f.reservations
      .filter((r) => r.status === "active" && !r.rollId && r.productId === productId && r.locationId === locationId)
      .map((r) => r.quantity),
  );
  return boxedOnHand(f.stockMovements, productId, locationId).minus(held);
}

/** One adjustment as the store records it: approved ones carry the movement they wrote. */
function adjustment(
  ctx: GenContext,
  index: number,
  plan: { productId: string; locationId: string; quantity: string; reason: StockAdjustment["reason"]; note: string },
  by: User,
  daysAgo: number,
  pending: boolean,
): { adjustment: StockAdjustment; movement: StockMovement | null } {
  const at = `${addDays(ctx.anchor, -daysAgo)}T10:30`;
  const id = ctx.id("adj");
  const number = `ADJ-${String(index + 1).padStart(4, "0")}`;
  return {
    adjustment: {
      id,
      number,
      productId: plan.productId,
      rollId: null,
      locationId: plan.locationId,
      quantity: plan.quantity,
      reason: plan.reason,
      note: plan.note,
      status: pending ? "pending" : "approved",
      requestedById: by.id,
      requestedBy: by.name,
      requestedAt: at,
      reviewedBy: null,
      reviewedAt: null,
      rejectReason: null,
    },
    movement: pending
      ? null
      : {
          id: ctx.id("mov"),
          at,
          productId: plan.productId,
          locationId: plan.locationId,
          quantity: plan.quantity,
          kind: "adjustment",
          source: { kind: "adjustment", id, number },
          byUserId: by.id,
        },
  };
}

/**
 * Stock adjustments (spec C1): cartons damaged in unloading, a cycle-count correction, boards
 * taken for showroom samples. They stay as history; nothing waits for approval now that the
 * Adjustments page is switched off (plan A-1). Only stock that is free is taken out.
 */
function adjustments(ctx: GenContext, f: CompanyFixtures) {
  const warehouse = f.locations.find((l) => l.isDefault);
  const by = f.users.find((u) => u.roleIds.some((r) => r.endsWith("-role-warehouse"))) ?? f.users[0];
  if (!warehouse || !by) return { adjustments: [], movements: [] };
  const roomy = f.products.filter(
    (p) => p.sqFtPerCarton && freeStock(f, p.id, warehouse.id).gte(dec(10).times(p.sqFtPerCarton)),
  );
  if (roomy.length < 3) return { adjustments: [], movements: [] };
  const [a, b] = roomy as [(typeof roomy)[0], (typeof roomy)[0]];
  const cartons = (p: (typeof roomy)[0], count: number) => dec(count).times(p.sqFtPerCarton!).toString();
  const plans = [
    {
      productId: a.id,
      quantity: cartons(a, -2),
      reason: "damage" as const,
      note: "Two cartons crushed when the truck was unloaded.",
      daysAgo: 9,
    },
    {
      productId: b.id,
      quantity: cartons(b, 4),
      reason: "count" as const,
      note: "Cycle count found four more than the system.",
      daysAgo: 5,
    },
    {
      productId: a.id,
      quantity: cartons(a, -1),
      reason: "samples" as const,
      note: "Boards for the showroom display.",
      daysAgo: 3,
    },
  ];
  const approval = f.settings.inventory.adjustmentApprovalQty;
  const made = plans.map((p, i) =>
    adjustment(
      ctx,
      i,
      { ...p, locationId: warehouse.id },
      by,
      p.daysAgo,
      adjustmentNeedsApproval(p.quantity, approval),
    ),
  );
  return {
    adjustments: made.map((m) => m.adjustment),
    movements: made.flatMap((m) => (m.movement ? [m.movement] : [])),
  };
}

/**
 * Records added after every seeded builder has run (feature batch 2, H): they draw no random
 * numbers and only add ids of their own, so everything generated before stays exactly as it was.
 */
export function withExtras(ctx: GenContext, f: CompanyFixtures): CompanyFixtures {
  const adjusted = adjustments(ctx, f);
  return {
    ...f,
    jobs: [...f.jobs, ...unbilledJob(ctx, f)],
    stockAdjustments: adjusted.adjustments,
    stockMovements: [...f.stockMovements, ...adjusted.movements],
  };
}
