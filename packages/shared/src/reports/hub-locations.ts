import type { Location } from "../types";
import { REPORT_QUERY_MESSAGES as M } from "./periods";

/** The three hub reports beside the Business report (spec rule 24). */
export type HubReportKind = "pnl" | "sales" | "payments";

/** What a hub report's place filter is called, what its first option says and which places it lists. */
export interface HubLocationFilter {
  label: string;
  all: string;
  /** Every live location, or only warehouses. */
  kinds: "any" | "warehouse";
  /** The refusal for a place the filter does not offer, as the API and the demo say it. */
  refusal: string;
}

/**
 * The place filter of each hub report (spec rule 24). Profit and loss reads its location as the
 * Business report's Locations filter with that one location ticked, where the sale was made
 * (ADR 0061 decision 2), so it is called Location and lists every live location, showrooms too.
 * Sales by category and Payments received compare where an invoice ships from, so they keep
 * Warehouse and list warehouses only.
 */
export const HUB_LOCATION_FILTERS: Record<HubReportKind, HubLocationFilter> = {
  pnl: { label: "Location", all: "All locations", kinds: "any", refusal: M.location },
  sales: { label: "Warehouse", all: "All warehouses", kinds: "warehouse", refusal: M.warehouse },
  payments: { label: "Warehouse", all: "All warehouses", kinds: "warehouse", refusal: M.warehouse },
};

/** The places a hub report's filter offers, from the live locations, in their given order. */
export function hubLocationsOf<T extends Pick<Location, "kind">>(report: HubReportKind, live: readonly T[]): T[] {
  return HUB_LOCATION_FILTERS[report].kinds === "any" ? [...live] : live.filter((l) => l.kind === "warehouse");
}

/**
 * Why a hub report refuses this place, or null (rule 24; ADR 0055 S10): no place is every place,
 * and any other must be one the filter offers. The API and the demo both ask this.
 */
export function hubLocationProblem(
  report: HubReportKind,
  id: string | null,
  live: readonly Pick<Location, "id" | "kind">[],
): string | null {
  if (id === null || hubLocationsOf(report, live).some((l) => l.id === id)) return null;
  return HUB_LOCATION_FILTERS[report].refusal;
}
