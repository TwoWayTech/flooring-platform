"use client";

import { useReducer } from "react";
import {
  quoteLineFor,
  remeasureLines,
  type Address,
  type DocLine,
  type Product,
  type Quote,
  type Room,
  type TaxOverride,
  type WasteCategory,
} from "@workspace/shared";

/** The company's waste % per category, for new lines (spec B3). */
type WasteDefaults = Record<WasteCategory, string>;

/** Changes the builder can make to a quote draft. */
export type DraftAction =
  | { type: "customer"; customerId: string; jobSite: Address }
  | { type: "jobSite"; jobSite: Address }
  | { type: "location"; locationId: string }
  | { type: "soldAt"; locationId: string }
  | { type: "taxOverride"; override: TaxOverride | null }
  | { type: "addRoom"; room: Room }
  | { type: "updateRoom"; room: Room }
  | { type: "removeRoom"; roomId: string }
  | { type: "addProduct"; product: Product; lineId: string }
  | { type: "updateLine"; line: DocLine }
  | { type: "removeLine"; lineId: string }
  | { type: "deposit"; depositPct: string }
  | { type: "notes"; notes: string }
  /** The quote as the store saved it, e.g. after a status change. */
  | { type: "saved"; quote: Quote };

function reducer(products: readonly Product[], waste: WasteDefaults) {
  return (draft: Quote, action: DraftAction): Quote => {
    const remeasure = (q: Quote): Quote => ({ ...q, lines: remeasureLines(q.lines, q.rooms, products) });
    switch (action.type) {
      case "customer":
        return { ...draft, customerId: action.customerId, jobSite: action.jobSite };
      case "jobSite":
        return { ...draft, jobSite: action.jobSite };
      case "location":
        return { ...draft, locationId: action.locationId };
      case "soldAt":
        return { ...draft, soldAtLocationId: action.locationId };
      case "taxOverride":
        return { ...draft, taxOverride: action.override };
      case "addRoom": {
        // A new room joins every line that is measured from all rooms.
        const all = draft.rooms.map((r) => r.id);
        const lines = draft.lines.map((l) =>
          l.roomIds && all.every((id) => l.roomIds!.includes(id))
            ? { ...l, roomIds: [...l.roomIds, action.room.id] }
            : l,
        );
        return remeasure({ ...draft, rooms: [...draft.rooms, action.room], lines });
      }
      case "updateRoom":
        return remeasure({ ...draft, rooms: draft.rooms.map((r) => (r.id === action.room.id ? action.room : r)) });
      case "removeRoom": {
        const lines = draft.lines.map((l) =>
          l.roomIds ? { ...l, roomIds: l.roomIds.filter((id) => id !== action.roomId) } : l,
        );
        return remeasure({ ...draft, rooms: draft.rooms.filter((r) => r.id !== action.roomId), lines });
      }
      case "addProduct":
        return remeasure({
          ...draft,
          lines: [...draft.lines, quoteLineFor(action.product, action.lineId, draft.rooms, waste)],
        });
      case "updateLine":
        return remeasure({ ...draft, lines: draft.lines.map((l) => (l.id === action.line.id ? action.line : l)) });
      case "removeLine":
        return { ...draft, lines: draft.lines.filter((l) => l.id !== action.lineId) };
      case "deposit":
        return { ...draft, depositPct: action.depositPct };
      case "notes":
        return { ...draft, notes: action.notes };
      case "saved":
        return action.quote;
    }
  };
}

/** Local draft of a quote being built; changes stay on screen until the person saves. */
export function useQuoteDraft(initial: Quote, products: readonly Product[], waste: WasteDefaults) {
  return useReducer(reducer(products, waste), initial);
}
