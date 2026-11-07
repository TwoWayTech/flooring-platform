import type { ProductCategory } from "../../src/types";

/**
 * Invented names for the catalog and suppliers. None of these is a real manufacturer or brand
 * (CLAUDE.md rule 10); keep it that way when adding entries.
 */

/** Brand and supplier for each category; suppliers get the same names. */
export const BRANDS: Record<Exclude<ProductCategory, "service">, readonly string[]> = {
  carpet: ["Northline Mills", "Loomcraft"],
  carpet_tile: ["Loomcraft"],
  lvp: ["Coastal Plank Co.", "Tidewater Vinyl"],
  laminate: ["Coastal Plank Co.", "Bluewater Laminates"],
  engineered_hardwood: ["Ridgeway Hardwood", "Oakhaven Timber"],
  solid_hardwood: ["Ridgeway Hardwood"],
  porcelain_tile: ["Stonecrest Tile", "Granite Peak Ceramics"],
  pad: ["CushionPro"],
  adhesive_trim: ["BondLine Supply"],
};

/** Suppliers that sell no catalog brand but appear on purchase orders for tools and freight. */
export const EXTRA_SUPPLIERS = [
  "Prairie Fiber Works",
  "Cobalt Underlayment",
  "Ironbark Flooring Tools",
  "Meridian Distribution",
  "Lakeshore Freight Lines",
] as const;

/** Collection names per category. */
export const COLLECTIONS: Record<Exclude<ProductCategory, "service">, readonly string[]> = {
  carpet: ["Harbor Twist", "Cedar Ridge", "Meadow Loop", "Quarry Path", "Bayline Plush", "Fieldstone"],
  carpet_tile: ["Gridline Modular", "Terrace Tile"],
  lvp: ["Shoreline Plank", "Weathered Pier", "Canyon Rigid Core", "Millhouse"],
  laminate: ["Prairie Board", "Timberline Classic"],
  engineered_hardwood: ["Heritage Wide Plank", "Riverbend"],
  solid_hardwood: ["Homestead Strip"],
  porcelain_tile: ["Quarry Stone", "Atelier Concrete", "Linen Weave"],
  pad: ["ComfortStep", "DenseGuard"],
  adhesive_trim: ["ProSet", "EdgeLine"],
};

/** Color names with a swatch hex, used for product color and the swatch chip. */
export const COLORWAYS: readonly (readonly [string, string])[] = [
  ["Driftwood", "#A89B86"],
  ["Oat Husk", "#CBBE9F"],
  ["Slate Harbor", "#5D6B70"],
  ["Pewter", "#8B8F8C"],
  ["Cobblestone", "#77736B"],
  ["Juniper", "#5F7462"],
  ["Sand Dune", "#C9B48E"],
  ["Morning Fog", "#B9BDB8"],
  ["Walnut Shell", "#6B4F3A"],
  ["Linen", "#DCD3C2"],
  ["Graphite", "#4A4D4F"],
  ["Sea Glass", "#9DB7AE"],
  ["Smoked Oak", "#7D6450"],
  ["Honey Wheat", "#C49A5E"],
  ["Ash Grey", "#A3A39E"],
  ["Barnwood", "#8A7663"],
  ["Ivory Lace", "#E6DFCF"],
  ["Charcoal Tweed", "#3F4245"],
];

/** Carpet construction attributes (spec section 4). */
export const CARPET_FIBERS = ["nylon", "polyester", "wool", "triexta"] as const;
export const CARPET_CONSTRUCTIONS = ["cut pile", "loop", "cut-loop"] as const;
export const WOOD_SPECIES = ["white oak", "red oak", "hickory", "maple", "walnut"] as const;
export const TILE_SIZES = ["12 x 24 in", "24 x 24 in", "8 x 48 in", "6 x 36 in"] as const;

/** Room names for the quote canvas. */
export const ROOM_NAMES = [
  "Living room",
  "Primary bedroom",
  "Bedroom 2",
  "Hall",
  "Kitchen",
  "Basement",
  "Den",
  "Office",
  "Dining room",
] as const;

/** Captions and tones for placeholder job photos (no real photos ship with the demo). */
export const PHOTO_CAPTIONS = [
  "Subfloor before install",
  "Seam placement",
  "Transition at doorway",
  "Stairs finished",
  "Final walkthrough",
  "Baseboard detail",
] as const;

/** Two-letter code of a brand for SKUs and roll numbers: "Northline Mills" is NM, "Loomcraft" is LO. */
export function brandCode(brand: string): string {
  const capitals = brand.replace(/[^A-Z]/g, "");
  return (capitals.length >= 2 ? capitals : brand).slice(0, 2).toUpperCase();
}
