import { addDays } from "../../src/dates";
import { dec } from "../../src/money";
import type { Product, ProductCategory, Supplier } from "../../src/types";
import type { GeneratedSupplier } from "./directory";
import { SQ_FT_PER_SQ_YD, type SellUnit } from "../../src/units";
import type { GenContext } from "./context";
import {
  BRANDS,
  brandCode,
  CARPET_CONSTRUCTIONS,
  CARPET_FIBERS,
  COLLECTIONS,
  COLORWAYS,
  EXTRA_SUPPLIERS,
  TILE_SIZES,
  WOOD_SPECIES,
} from "./vocabulary";

type GoodsCategory = Exclude<ProductCategory, "service">;

/** How many products of each category make up the 120-product catalog (spec section 4). */
const CATEGORY_COUNTS: Record<GoodsCategory, number> = {
  carpet: 30,
  carpet_tile: 10,
  lvp: 22,
  laminate: 10,
  engineered_hardwood: 10,
  solid_hardwood: 6,
  porcelain_tile: 14,
  pad: 5,
  adhesive_trim: 6,
};

/**
 * Price range by category, per sq ft (spec A1); broadloom and pad were priced per sq yd and are
 * drawn the same way, then divided by nine, so the random numbers drawn do not change.
 */
const PRICING: Record<GoodsCategory, { unit: SellUnit; min: number; max: number; coverage?: string[]; bySqYd?: true }> =
  {
    carpet: { unit: "sq_ft", min: 22, max: 68, bySqYd: true },
    carpet_tile: { unit: "sq_ft", min: 2.4, max: 4.6, coverage: ["48.00", "36.00"] },
    lvp: { unit: "sq_ft", min: 2.49, max: 6.99, coverage: ["23.64", "19.80", "21.45", "28.50"] },
    laminate: { unit: "sq_ft", min: 1.79, max: 3.99, coverage: ["22.35", "18.60"] },
    engineered_hardwood: { unit: "sq_ft", min: 4.99, max: 9.99, coverage: ["20.00", "26.40"] },
    solid_hardwood: { unit: "sq_ft", min: 6.99, max: 12.99, coverage: ["20.00"] },
    porcelain_tile: { unit: "sq_ft", min: 2.99, max: 8.99, coverage: ["15.50", "10.76"] },
    pad: { unit: "sq_ft", min: 3.5, max: 9, bySqYd: true },
    adhesive_trim: { unit: "each", min: 12, max: 95 },
  };

/**
 * Services sold on quotes. Each names its tax category, because installation labor is taxed
 * differently by state (blueprint "Sales tax engine").
 */
const SERVICES: readonly { name: string; unit: SellUnit; price: string; cost: string; taxCategory: string }[] = [
  { name: "Carpet installation", unit: "sq_ft", price: "1.10", cost: "0.62", taxCategory: "labor" },
  { name: "Hard surface installation", unit: "sq_ft", price: "2.75", cost: "1.55", taxCategory: "labor" },
  { name: "Tile installation", unit: "sq_ft", price: "6.50", cost: "3.70", taxCategory: "labor" },
  { name: "Removal and haul-away", unit: "sq_ft", price: "0.85", cost: "0.40", taxCategory: "labor" },
  { name: "Stair installation", unit: "step", price: "45.00", cost: "24.00", taxCategory: "labor" },
  { name: "Furniture moving", unit: "each", price: "65.00", cost: "30.00", taxCategory: "service" },
  { name: "Delivery", unit: "each", price: "95.00", cost: "55.00", taxCategory: "freight" },
];

/** One supplier per catalog brand plus a few for tools and freight. */
export function buildSuppliers(ctx: GenContext): GeneratedSupplier[] {
  const brandCategories = new Map<string, GoodsCategory[]>();
  for (const [category, brands] of Object.entries(BRANDS) as [GoodsCategory, readonly string[]][]) {
    for (const brand of brands) brandCategories.set(brand, [...(brandCategories.get(brand) ?? []), category]);
  }
  const names = [...brandCategories.keys(), ...EXTRA_SUPPLIERS];
  return names.map((name) => ({
    id: ctx.id("sup"),
    name,
    contactName: ctx.rng.personName(),
    email: `orders@${name.toLowerCase().replace(/[^a-z]/g, "")}.example`,
    phone: ctx.rng.phone(String(ctx.rng.int(201, 989))),
    // Same draw as before (four choices), so later fixtures stay put; the terms are the batch 2 ones.
    terms: ctx.rng.pick(["net_30", "net_30", "net_60", "cod"] as const),
    creditLimit: "0",
    categories: brandCategories.get(name) ?? [],
    address: {
      street: ctx.rng.faker.location.streetAddress(),
      city: ctx.rng.faker.location.city(),
      state: ctx.rng.pick(["GA", "TN", "NC", "OH", "TX", "PA"]),
      zip: String(ctx.rng.int(10000, 79999)),
    },
  }));
}

/** Attributes per category (spec section 4: fiber, construction, face weight, wear layer, species). */
function attributesFor(ctx: GenContext, category: GoodsCategory, widthFt?: string): Record<string, string> {
  const { rng } = ctx;
  switch (category) {
    case "carpet":
      return {
        fiber: rng.pick(CARPET_FIBERS),
        construction: rng.pick(CARPET_CONSTRUCTIONS),
        faceWeightOz: String(rng.int(28, 70)),
        widthFt: String(widthFt),
      };
    case "carpet_tile":
      return { fiber: "nylon", construction: rng.pick(CARPET_CONSTRUCTIONS), size: "24 x 24 in" };
    case "lvp":
      return { wearLayerMil: String(rng.pick([12, 20, 22, 28])), thicknessMm: rng.pick(["5.0", "6.5", "8.0"]) };
    case "laminate":
      return { thicknessMm: rng.pick(["8", "10", "12"]), acRating: rng.pick(["AC3", "AC4"]) };
    case "engineered_hardwood":
    case "solid_hardwood":
      return { species: rng.pick(WOOD_SPECIES), widthIn: rng.pick(["3.25", "5", "7.5"]), finish: "matte" };
    case "porcelain_tile":
      return { size: rng.pick(TILE_SIZES), finish: rng.pick(["matte", "polished", "textured"]) };
    case "pad":
      return { densityLb: rng.pick(["6", "8", "10"]), thicknessIn: rng.pick(["0.375", "0.4375", "0.5"]) };
    case "adhesive_trim":
      return { kind: rng.pick(["adhesive", "stair nose", "T-molding", "reducer", "quarter round"]) };
  }
}

/** A product of a goods category with price, cost and stock. Cost runs 52 to 68 % of price. */
/**
 * A product as the catalog builder makes it: boxed goods also carry the cartons counted on hand,
 * which the stock builder turns into opening ledger lines (fixtures/stock.ts).
 */
export type GeneratedProduct = Product & { cartonsOnHand?: number };

function goodsProduct(
  ctx: GenContext,
  category: GoodsCategory,
  suppliers: readonly Supplier[],
  index: number,
): GeneratedProduct {
  const { rng } = ctx;
  const pricing = PRICING[category];
  const brand = rng.pick(BRANDS[category]);
  const collection = rng.pick(COLLECTIONS[category]);
  const [colorName, swatch] = COLORWAYS[(index * 7 + rng.int(0, 3)) % COLORWAYS.length]!;
  const coverage = pricing.coverage ? rng.pick(pricing.coverage) : undefined;
  const drawn = dec(rng.money(pricing.min, pricing.max));
  const price = pricing.bySqYd ? drawn.dividedBy(SQ_FT_PER_SQ_YD).toDecimalPlaces(2) : drawn;
  const cost = price.times(rng.decimal(0.52, 0.68, 2)).toDecimalPlaces(2);
  const widthFt = category === "carpet" ? String(rng.pick([12, 12, 15])) : undefined;
  const boxed = coverage !== undefined;
  return {
    id: ctx.id("prd"),
    sku: `${brandCode(brand)}-${rng.int(1000, 9999)}`,
    name: `${collection} ${colorName}`,
    brand,
    collection,
    colorName,
    swatch,
    category,
    unit: pricing.unit,
    price: price.toFixed(2),
    cost: cost.toFixed(2),
    ...(coverage ? { sqFtPerCarton: coverage } : {}),
    ...(boxed || category === "adhesive_trim"
      ? {
          cartonsOnHand: rng.chance(0.12) ? rng.int(2, 15) : rng.int(25, 180),
          reorderPoint: dec(rng.int(20, 40))
            .times(coverage ?? 1)
            .toString(),
        }
      : {}),
    ...(widthFt ? { widthFt } : {}),
    attributes: attributesFor(ctx, category, widthFt),
    supplierId: suppliers.find((s) => s.name === brand)!.id,
    createdAt: addDays(ctx.anchor, -rng.int(120, 900)),
  };
}

/** The 120-product catalog: goods by category, then services. */
export function buildProducts(ctx: GenContext, suppliers: readonly Supplier[]): GeneratedProduct[] {
  const goods = (Object.entries(CATEGORY_COUNTS) as [GoodsCategory, number][]).flatMap(([category, count]) =>
    Array.from({ length: count }, (_, i) => goodsProduct(ctx, category, suppliers, i)),
  );
  // One product with a long name (60+ characters), so wrapping and truncation can be checked (spec D1).
  const long = goods.filter((p) => p.category === "lvp").at(-1);
  if (long) long.name = `${long.name} Wide Plank Rigid Core with Attached Cork Pad`;
  const house = suppliers.find((s) => s.name === "Meridian Distribution")!;
  const services: Product[] = SERVICES.map((s) => ({
    id: ctx.id("prd"),
    sku: `SVC-${s.name.slice(0, 3).toUpperCase()}`,
    name: s.name,
    brand: ctx.company.name,
    collection: "Services",
    colorName: "",
    swatch: "#9FB0AE",
    category: "service",
    unit: s.unit,
    price: s.price,
    cost: s.cost,
    attributes: { taxCategory: s.taxCategory },
    supplierId: house.id,
    createdAt: addDays(ctx.anchor, -900),
  }));
  return [...goods, ...services];
}
