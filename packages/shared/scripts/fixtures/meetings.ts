import { addDays, mondayOf } from "../../src/dates";
import type { Attendee, Customer, Meeting, Supplier, User } from "../../src/types";
import type { GenContext } from "./context";

type Recurrence = Meeting["recurrence"];

/** Meeting templates per company; together they make the 25 meetings of spec section 4. */
interface Template {
  title: string;
  recurrence: Recurrence;
  with?: "customer" | "supplier";
}

const TEMPLATES: Record<string, readonly Template[]> = {
  summit: [
    { title: "Weekly sales huddle", recurrence: "weekly" },
    { title: "Monthly safety talk", recurrence: "monthly" },
    { title: "Design consultation", recurrence: "none", with: "customer" },
    { title: "Install walkthrough", recurrence: "none", with: "customer" },
    { title: "Final inspection", recurrence: "none", with: "customer" },
    { title: "Line review", recurrence: "none", with: "supplier" },
    { title: "Contractor pricing review", recurrence: "none", with: "customer" },
    { title: "Crew scheduling", recurrence: "biweekly" },
    { title: "Sample delivery", recurrence: "none", with: "supplier" },
    { title: "Showroom reset planning", recurrence: "none" },
  ],
  keystone: [
    { title: "Weekly operations meeting", recurrence: "weekly" },
    { title: "Dealer pricing review", recurrence: "none", with: "customer" },
    { title: "Credit review", recurrence: "monthly" },
    { title: "Line review", recurrence: "none", with: "supplier" },
    { title: "Freight rates call", recurrence: "none", with: "supplier" },
    { title: "Dealer open house planning", recurrence: "none", with: "customer" },
    { title: "Inventory count debrief", recurrence: "none" },
    { title: "Account review", recurrence: "none", with: "customer" },
  ],
  harbor: [
    { title: "Weekly recruiter standup", recurrence: "weekly" },
    { title: "Payroll close", recurrence: "biweekly" },
    { title: "Placement review: San Diego", recurrence: "monthly" },
    { title: "New hire orientation", recurrence: "none" },
    { title: "Compliance training", recurrence: "none" },
    { title: "Benefits enrollment Q and A", recurrence: "none" },
    { title: "Quarterly planning", recurrence: "none" },
  ],
};

/**
 * A workday `slot` weekdays after the Monday `firstWeek` weeks from the anchor's week, so one
 * random draw spreads meetings evenly over Monday to Friday.
 */
function workday(anchor: string, firstWeek: number, slot: number): string {
  return addDays(mondayOf(anchor), (firstWeek + Math.floor(slot / 5)) * 7 + (slot % 5));
}

function staff(users: readonly User[], count: number, ctx: GenContext): Attendee[] {
  const active = users.filter((u) => u.status === "active");
  return ctx.rng.sample(active, count).map((u) => ({ kind: "staff", id: u.id, name: u.name }));
}

/**
 * One-off meetings from a week back to two weeks ahead; recurring series began weeks ago so they
 * show every week of the calendar. Staff, customers or suppliers attend.
 */
export function buildMeetings(
  ctx: GenContext,
  users: readonly User[],
  customers: readonly Customer[],
  suppliers: readonly Supplier[],
): Meeting[] {
  return (TEMPLATES[ctx.company.id] ?? []).map((template) => {
    const attendees = staff(users, ctx.rng.int(2, 4), ctx);
    let title = template.title;
    if (template.with === "customer" && customers.length > 0) {
      const customer = ctx.rng.pick(customers);
      attendees.push({ kind: "customer", id: customer.id, name: customer.name });
      title = `${title}: ${customer.name}`;
    }
    if (template.with === "supplier" && suppliers.length > 0) {
      const supplier = ctx.rng.pick(suppliers);
      attendees.push({ kind: "supplier", id: supplier.id, name: supplier.name });
      title = `${title}: ${supplier.name}`;
    }
    const day =
      template.recurrence === "none"
        ? workday(ctx.anchor, -1, ctx.rng.int(0, 19))
        : workday(ctx.anchor, -6, ctx.rng.int(0, 14));
    return {
      id: ctx.id("mtg"),
      title,
      start: `${day}T${ctx.rng.pick(["08:30", "09:00", "10:30", "13:00", "14:00", "15:30"])}`,
      durationMin: ctx.rng.pick([30, 45, 60, 60, 90]),
      location:
        template.with === "customer" ? "On site" : ctx.rng.pick(["Conference room", "Video call", "Showroom floor"]),
      attendees,
      recurrence: template.recurrence,
      reminderMin: ctx.rng.pick([10, 15, 30, 60]),
      ownerUserId: attendees[0]!.id,
      notes: "",
    };
  });
}
