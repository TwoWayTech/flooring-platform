"use client";

import { useReducer } from "react";
import {
  productTaxCategory,
  remeasureLines,
  type Address,
  type DocLine,
  type Product,
  type Quote,
  type Room,
  type TaxOverride,
} from "@workspace/shared";

/** Waste allowance a new material line starts with, by category (design: carpet and tile cut more). */
export function defaultWastePct(product: Product): string {
  if (product.category === "carpet") return "12";
  if (product.category === "porcelain_tile") return "10";
  return product.category === "service" ? "0" : "8";
}

/** Changes the builder can make to a quote draft. */
export type DraftAction =
  | { type: "customer"; customerId: string; jobSite: Address }
  | { type: "jobSite"; jobSite: Address }
  | { type: "location"; locationId: string }
  | { type: "taxOverride"; override: TaxOverride | null }
  | { type: "addRoom"; room: Room }
  | { type: "updateRoom"; room: Room }
  | { type: "removeRoom"; roomId: string }
  | { type: "addProduct"; product: Product; lineId: string }
  | { type: "updateLine"; line: DocLine }
  | { type: "removeLine"; lineId: string }
  | { type: "deposit"; depositPct: string }
  | { type: "notes"; notes: string };

/** Whether a product is measured from the rooms: goods sold by area, and labor sold per sq ft. */
function measuredFromRooms(product: Product): boolean {
  if (product.category === "service") return product.unit === "sq_ft";
  return product.unit === "sq_yd" || product.unit === "carton";
}

/** A new line for a product: tied to every room when it is measured by area, otherwise one unit. */
function lineFor(product: Product, lineId: string, rooms: readonly Room[]): DocLine {
  const linked = rooms.length > 0 && measuredFromRooms(product);
  return {
    id: lineId,
    productId: product.id,
    description: product.category === "service" ? product.name : `${product.brand} ${product.name}`,
    category: productTaxCategory(product),
    unit: product.unit,
    quantity: "1",
    unitPrice: product.price,
    unitCost: product.cost,
    ...(product.category !== "service" ? { wastePct: defaultWastePct(product) } : {}),
    ...(linked ? { roomIds: rooms.map((r) => r.id) } : {}),
  };
}

function reducer(products: readonly Product[]) {
  return (draft: Quote, action: DraftAction): Quote => {
    const remeasure = (q: Quote): Quote => ({ ...q, lines: remeasureLines(q.lines, q.rooms, products) });
    switch (action.type) {
      case "customer":
        return { ...draft, customerId: action.customerId, jobSite: action.jobSite };
      case "jobSite":
        return { ...draft, jobSite: action.jobSite };
      case "location":
        return { ...draft, locationId: action.locationId };
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
        return remeasure({ ...draft, lines: [...draft.lines, lineFor(action.product, action.lineId, draft.rooms)] });
      case "updateLine":
        return remeasure({ ...draft, lines: draft.lines.map((l) => (l.id === action.line.id ? action.line : l)) });
      case "removeLine":
        return { ...draft, lines: draft.lines.filter((l) => l.id !== action.lineId) };
      case "deposit":
        return { ...draft, depositPct: action.depositPct };
      case "notes":
        return { ...draft, notes: action.notes };
    }
  };
}

/** Local draft of a quote being built; changes stay on screen until the person saves. */
export function useQuoteDraft(initial: Quote, products: readonly Product[]) {
  return useReducer(reducer(products), initial);
}
