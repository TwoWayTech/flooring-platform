import { productTaxCategory, type DocLine } from "../../src/documents";
import { dec } from "../../src/money";
import { quantityForArea, roomAreaSqFt } from "../../src/units";
import type { Product, ProductCategory, Room } from "../../src/types";
import type { GenContext } from "./context";
import { ROOM_NAMES } from "./vocabulary";

/** Waste allowance by material: patterned carpet and tile cut more than plank (spec "Quote builder"). */
const WASTE_PCT: Partial<Record<ProductCategory, string>> = { carpet: "12", porcelain_tile: "10" };
const DEFAULT_WASTE_PCT = "8";

const MAIN_MATERIALS: readonly ProductCategory[] = [
  "carpet",
  "carpet",
  "carpet",
  "carpet",
  "lvp",
  "lvp",
  "lvp",
  "laminate",
  "engineered_hardwood",
  "solid_hardwood",
  "porcelain_tile",
];

/** Rooms of a home measured on the quote canvas, packed left to right in rows (feet). */
export function buildRooms(ctx: GenContext): Room[] {
  const { rng } = ctx;
  const names = rng.sample(ROOM_NAMES, rng.int(1, 4));
  let x = 0;
  let y = 0;
  let rowDepth = 0;
  return names.map((name) => {
    const hall = name === "Hall";
    const widthFt = hall ? 4 : rng.int(9, 22);
    const lengthFt = hall ? rng.int(10, 16) : rng.int(9, 24);
    if (x + widthFt > 44) {
      x = 0;
      y += rowDepth + 2;
      rowDepth = 0;
    }
    const room = { id: ctx.id("room"), name, x, y, widthFt, lengthFt };
    x += widthFt + 2;
    rowDepth = Math.max(rowDepth, lengthFt);
    return room;
  });
}

/** One document line for a product at a quantity. */
export function lineFor(ctx: GenContext, product: Product, quantity: string, extra: Partial<DocLine> = {}): DocLine {
  return {
    id: ctx.id("ln"),
    productId: product.id,
    description: product.category === "service" ? product.name : `${product.brand} ${product.name}`,
    category: productTaxCategory(product),
    unit: product.unit,
    quantity,
    unitPrice: product.price,
    unitCost: product.cost,
    ...(product.sqFtPerCarton ? { sqFtPerCarton: product.sqFtPerCarton } : {}),
    ...extra,
  };
}

function service(products: readonly Product[], name: string): Product {
  return products.find((p) => p.category === "service" && p.name === name)!;
}

function installServiceFor(category: ProductCategory): string {
  if (category === "carpet") return "Carpet installation";
  if (category === "porcelain_tile") return "Tile installation";
  return "Hard surface installation";
}

/**
 * Lines for a measured home: the main material with waste, pad under carpet, installation
 * labor on the net area, and optional removal, stairs, furniture moving and trims.
 */
export function roomLines(ctx: GenContext, products: readonly Product[], rooms: readonly Room[]): DocLine[] {
  const { rng } = ctx;
  const category = rng.pick(MAIN_MATERIALS);
  const material = rng.pick(products.filter((p) => p.category === category));
  const area = rooms.reduce((sum, r) => sum.plus(roomAreaSqFt(r.widthFt, r.lengthFt)), dec(0));
  const waste = WASTE_PCT[category] ?? DEFAULT_WASTE_PCT;
  const roomIds = rooms.map((r) => r.id);
  const quantity = quantityForArea(area, waste, material.sqFtPerCarton).toString();
  const lines = [lineFor(ctx, material, quantity, { wastePct: waste, roomIds })];
  if (category === "carpet") {
    const pad = rng.pick(products.filter((p) => p.category === "pad"));
    lines.push(lineFor(ctx, pad, quantity, { wastePct: waste, roomIds }));
  }
  lines.push(lineFor(ctx, service(products, installServiceFor(category)), area.toFixed(2), { roomIds }));
  if (rng.chance(0.5))
    lines.push(lineFor(ctx, service(products, "Removal and haul-away"), area.toFixed(2), { roomIds }));
  if (category === "carpet" && rng.chance(0.3)) {
    lines.push(lineFor(ctx, service(products, "Stair installation"), String(rng.int(12, 14))));
  }
  if (rng.chance(0.3)) lines.push(lineFor(ctx, service(products, "Furniture moving"), String(rooms.length)));
  if (category !== "carpet" && rng.chance(0.4)) {
    const trim = rng.pick(products.filter((p) => p.category === "adhesive_trim"));
    lines.push(lineFor(ctx, trim, String(rng.int(1, 6))));
  }
  return lines;
}

/** Quantity for a trade order: bulk sq ft for broadloom, whole cartons of sq ft for boxed goods. */
function tradeQuantity(ctx: GenContext, product: Product): string {
  if (product.category === "carpet") return String(ctx.rng.int(540, 5400));
  if (product.sqFtPerCarton) return dec(ctx.rng.int(20, 240)).times(product.sqFtPerCarton).toString();
  return String(ctx.rng.int(5, 60));
}

/** Lines for a dealer or contractor order: one to four products and usually a delivery. */
export function tradeLines(ctx: GenContext, products: readonly Product[]): DocLine[] {
  const goods = products.filter((p) => p.category !== "service" && p.category !== "pad");
  const lines = ctx.rng.sample(goods, ctx.rng.int(1, 4)).map((p) => lineFor(ctx, p, tradeQuantity(ctx, p)));
  if (ctx.rng.chance(0.6)) lines.push(lineFor(ctx, service(products, "Delivery"), "1"));
  return lines;
}
