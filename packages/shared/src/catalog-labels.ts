import type { ProductCategory } from "./types";

/** Plain-language names for catalog categories (spec section 4), shared by screens and the importer. */
export const CATEGORY_LABELS: Record<ProductCategory, string> = {
  carpet: "Carpet",
  carpet_tile: "Carpet tile",
  lvp: "LVP and LVT",
  laminate: "Laminate",
  engineered_hardwood: "Engineered hardwood",
  solid_hardwood: "Solid hardwood",
  porcelain_tile: "Porcelain tile",
  pad: "Pad and underlayment",
  adhesive_trim: "Adhesives and trims",
  service: "Services",
};
