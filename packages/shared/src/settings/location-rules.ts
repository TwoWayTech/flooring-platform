import { QUANTITY_TEXT } from "../decimal-text";
import type { DocLine } from "../documents";
import { fold } from "../import/fields";
import { dec } from "../money";
import { quoteIsOpen } from "../operations/quote-status";
import { boxedStock } from "../stock";
import type { Branch, Location, Quote, Reservation, Roll, StockMovement, Transfer } from "../types";
import { streetAddressProblem } from "./section-rules";
import { SETTINGS_SECTIONS, type SettingsSectionRule } from "./sections";

/**
 * Who may add or change a warehouse or showroom, the page's switch and the module (ADR 0059, part
 * 4a, D2): Stock rules' own (`SETTINGS_SECTIONS.inventory`), so the API guard, DemoStore and the
 * menu read one source (CLAUDE.md rule 4).
 */
export const LOCATION_RULE = {
  keys: SETTINGS_SECTIONS.inventory.keys,
  feature: SETTINGS_SECTIONS.inventory.feature,
  module: SETTINGS_SECTIONS.inventory.module,
} as const satisfies Pick<SettingsSectionRule, "keys" | "feature" | "module">;

/** The longest location name, where the name input stops typing (ADR 0059, part 4a, D9). */
export const LOCATION_NAME_MAX = 80;

/** The most display samples a showroom counts (ADR 0059, part 4a, D11). */
export const DISPLAY_SAMPLES_MAX = 100_000;

/** What Warehouses and showrooms says about what it refuses, the same words in both modes. */
export const LOCATION_MESSAGES = {
  name: "Enter a name people will recognise, such as Denver Central.",
  nameLength: `Keep the name to ${LOCATION_NAME_MAX} characters or fewer.`,
  kind: "Choose whether this is a warehouse or a showroom.",
  branch: "Choose the branch this location belongs to.",
  branchFixed:
    "A location stays in the branch it was added to: its expenses and quotes are seen by that branch. Add a new location instead.",
  samples: "Enter the display samples as a whole number from 0 to 100,000.",
  warehouseSamples: "Only showrooms count display samples; a warehouse has 0.",
  floorArea: "Enter the area in sq ft, for example 3200.",
  // Names the location that already has the name, as it is stored (D9).
  sameName: (stored: string) => `Another location is already called ${stored}.`,
  showroomDefault: "The default must be a warehouse; showrooms hold no sellable stock.",
  oneDefault: "Keep one warehouse as the company default.",
  holdsStock: (name: string) => `${name} holds stock. Transfer it out before making it a showroom.`,
  inTransit: (name: string) => `${name} has a transfer in transit. Receive it before making it a showroom.`,
  heldStock: (name: string) =>
    `${name} has stock held for invoices. Issue it, or void the invoice, before making it a showroom.`,
  openQuotes: (name: string) =>
    `Open quotes ship from ${name}. Move them to another warehouse or close them before making it a showroom.`,
} as const;

/** A location as a write sends it: everything but the id, which the API makes (ADR 0059, part 4a, D12). */
export type LocationInput = Omit<Location, "id">;

/** What a location's rule judges against: the stored row (undefined for a new one), the other live locations, the live branches. */
export interface LocationContext {
  before: Location | undefined;
  others: readonly Location[];
  branches: readonly Pick<Branch, "id">[];
}

/**
 * Why a location's content, branch, name or default can't be saved, or null (spec
 * settings-and-permissions.md rule 29; inventory.md rule 24; ADR 0059, part 4a, D5 to D11). The
 * first problem in this order: name, name length, kind, branch, address, samples, floor area, a name
 * another live location has, then the default. A new location needs a live branch of the company; an
 * edit keeps the branch it was added to, live or not (D5), because expense scope reads a location's
 * branch live and quotes take theirs from it on every save.
 */
export function locationProblem(input: LocationInput, context: LocationContext): string | null {
  const name = input.name.trim();
  if (name === "") return LOCATION_MESSAGES.name;
  if (name.length > LOCATION_NAME_MAX) return LOCATION_MESSAGES.nameLength;
  if (input.kind !== "warehouse" && input.kind !== "showroom") return LOCATION_MESSAGES.kind;
  if (!context.before && !context.branches.some((branch) => branch.id === input.branchId))
    return LOCATION_MESSAGES.branch;
  if (context.before && input.branchId !== context.before.branchId) return LOCATION_MESSAGES.branchFixed;
  const address = streetAddressProblem(input.address);
  if (address) return address;
  const samples = input.displaySamples;
  if (!Number.isInteger(samples) || samples < 0 || samples > DISPLAY_SAMPLES_MAX) return LOCATION_MESSAGES.samples;
  if (input.kind === "warehouse" && samples !== 0) return LOCATION_MESSAGES.warehouseSamples;
  const area = input.floorAreaSqFt;
  if (area !== undefined && area !== "" && !QUANTITY_TEXT.test(area)) return LOCATION_MESSAGES.floorArea;
  // Names compare as the opening-stock import finds a warehouse by name (`findLocation` in
  // import/lookup.ts takes the first folded match), so "Denver-Central" can't sit beside
  // "Denver Central" and send imported stock to the wrong one (D9).
  const taken = context.others.find((other) => fold(other.name) === fold(name));
  if (taken) return LOCATION_MESSAGES.sameName(taken.name);
  if (input.kind === "showroom" && input.isDefault) return LOCATION_MESSAGES.showroomDefault;
  if (!input.isDefault && !context.others.some((other) => other.isDefault)) return LOCATION_MESSAGES.oneDefault;
  return null;
}

/** Whether a save turns a stored warehouse into a showroom: the only change that needs the holds check (D6). */
export function becomesShowroom(before: Location | undefined, input: Pick<LocationInput, "kind">): boolean {
  return before?.kind === "warehouse" && input.kind === "showroom";
}

/** The records that point at one location, narrowed to what the holds rule reads. */
export interface LocationRecords {
  rolls: readonly Pick<Roll, "locationId" | "remainingLengthFt">[];
  movements: readonly Pick<StockMovement, "productId" | "locationId" | "quantity">[];
  transfers: readonly Pick<Transfer, "fromId" | "toId" | "status">[];
  reservations: readonly Pick<Reservation, "locationId" | "status" | "quantity">[];
  quotes: readonly (Pick<Quote, "status" | "locationId"> & { lines: readonly Pick<DocLine, "locationId">[] })[];
}

/** What keeps a warehouse from becoming a showroom (D6): stock, a transfer in transit, stock held for an invoice, an open quote. */
export interface LocationHolds {
  stock: boolean;
  transfers: boolean;
  holds: boolean;
  quotes: boolean;
}

/**
 * The holds of one location from any records (others' are ignored; inventory.md rule 24): a live
 * roll with length left (in transit too: a travelling roll keeps its sender's location), boxed stock
 * not zero (`boxedStock`), a transfer in transit from or to it (receiving one doesn't check the
 * kind), an active reservation whose quantity is above zero, and a quote `quoteIsOpen` from it by
 * header or line. A short row (quantity 0) holds nothing and nothing ever fills it (inventory.md
 * "Short lines stay short"), so it doesn't block (ADR 0059, part 4a, D22); quantities are read by
 * value, since the API answers "0.000".
 */
export function locationHolds(locationId: string, records: LocationRecords): LocationHolds {
  const boxed = [...boxedStock(records.movements, locationId).values()];
  return {
    stock:
      records.rolls.some((roll) => roll.locationId === locationId && dec(roll.remainingLengthFt).gt(0)) ||
      boxed.some((quantity) => !quantity.isZero()),
    transfers: records.transfers.some(
      (transfer) =>
        transfer.status === "in_transit" && (transfer.fromId === locationId || transfer.toId === locationId),
    ),
    holds: records.reservations.some(
      (held) => held.locationId === locationId && held.status === "active" && dec(held.quantity).gt(0),
    ),
    quotes: records.quotes.some(
      (quote) =>
        quoteIsOpen(quote) &&
        (quote.locationId === locationId || quote.lines.some((line) => line.locationId === locationId)),
    ),
  };
}

/** The refusal for the first hold, in the order stock, transfer, held stock, quotes, naming the location; null when none (D6). */
export function locationHoldsProblem(name: string, holds: LocationHolds): string | null {
  if (holds.stock) return LOCATION_MESSAGES.holdsStock(name);
  if (holds.transfers) return LOCATION_MESSAGES.inTransit(name);
  if (holds.holds) return LOCATION_MESSAGES.heldStock(name);
  if (holds.quotes) return LOCATION_MESSAGES.openQuotes(name);
  return null;
}

/** A location as both modes store it: the name trimmed, a blank floor area left out (D11); the rest as sent. */
export function locationStored(input: LocationInput): LocationInput {
  const stored: LocationInput = { ...input, name: input.name.trim() };
  if (stored.floorAreaSqFt === "") delete stored.floorAreaSqFt;
  return stored;
}
