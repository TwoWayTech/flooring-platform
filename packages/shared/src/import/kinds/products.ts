import { CATEGORY_LABELS } from "../../catalog-labels";
import { dec } from "../../money";
import { cartonPack, SQ_FT_PER_SQ_YD, UNIT_LABELS, type SellUnit } from "../../units";
import type { Product, ProductCategory } from "../../types";
import type { CellProblem } from "../types";
import { ambiguous, findParty, keepStored, patched, sameDecimal, text } from "../lookup";
import { skuKey } from "../lookups";
import type { KindContext, KindHandler, ParsedRow, RowOutcome } from "../plan";

/** Imported products start with a neutral chip until someone picks a color. */
const NEUTRAL_SWATCH = "#A39A8E";

/** Units a file may use: every selling unit, plus sq yd and cartons, which convert to sq ft (plan A-2). */
const FILE_UNIT_LABELS = { ...UNIT_LABELS, sq_yd: "sq yd", carton: "cartons" } as const;
type FileUnit = keyof typeof FILE_UNIT_LABELS;

/** The smallest price or cost that no longer fits numeric(14,4): eleven whole digits (ADR 0057 M3). */
const TOO_LARGE = dec("10000000000");

const refuse = (field: string, message: string): RowOutcome => ({ problems: [{ field, message }] });

/**
 * Coverage and width the product's unit needs (spec section 4): cartons need sq ft per carton in
 * every category, adhesives and trims included (ADR 0057 S-18), and broadloom a width.
 */
function unitProblems(category: ProductCategory, unit: FileUnit, row: ParsedRow, existing?: Product): CellProblem[] {
  const problems: CellProblem[] = [];
  if (unit === "carton" && !row.sq_ft_per_carton && !cartonPack(existing?.sqFtPerCarton)) {
    problems.push({ field: "sq_ft_per_carton", message: "Products sold by the carton need the sq ft per carton." });
  }
  if (category === "carpet" && !row.width_ft && !existing?.widthFt) {
    problems.push({ field: "width_ft", message: "Broadloom carpet needs its roll width in ft." });
  }
  return problems;
}

/**
 * A price from a file, per the catalog's unit (spec A1, plan A-2): the catalog is per sq ft, so a
 * price per sq yd is divided by nine and a price per carton by its coverage, to at most four
 * decimals (numeric(14,4)).
 */
function pricePerSellUnit(price: string, unit: FileUnit, coverage: string | undefined): string {
  if (unit === "sq_yd") return dec(price).dividedBy(SQ_FT_PER_SQ_YD).toDecimalPlaces(4).toString();
  if (unit === "carton" && coverage) return dec(price).dividedBy(coverage).toDecimalPlaces(4).toString();
  return price;
}

/** A converted price or cost that no longer fits the column (ADR 0057 M3, S-18), or null. */
function tooLarge(price: string, cost: string): CellProblem | null {
  if (dec(price).gte(TOO_LARGE)) {
    return { field: "price", message: "Price is too large once converted to a price per sq ft." };
  }
  if (dec(cost).gte(TOO_LARGE)) {
    return { field: "cost", message: "Cost is too large once converted to a price per sq ft." };
  }
  return null;
}

/** The SKU's live product: one, none, or a refusal when case variants of it are several products (ADR 0057 S-16). */
function matchSku(sku: string, ctx: KindContext): { product?: Product } | { problem: CellProblem } {
  const found = ctx.lookups.productsBySku.find(sku);
  if (found.length > 1) {
    return {
      problem: { field: "sku", message: `${found.length} products have the SKU “${sku}”. Fix them in the app first.` },
    };
  }
  return { product: found[0] };
}

/**
 * Whether an update would change what stock was valued at (ADR 0057 S-5, M4): once a product has
 * any stock movement or roll (stock in transit and deleted rolls included), its cost, category,
 * selling unit, coverage and roll width stay as they are, and the row is refused.
 */
function stockHistoryProblem(
  existing: Product,
  next: { cost: string; category: ProductCategory; unit: SellUnit; coverage: string | null; width: string | null },
  ctx: KindContext,
): CellProblem | null {
  if (!ctx.lookups.productsWithStock.has(existing.id)) return null;
  const costChanges = !sameDecimal(existing.cost, next.cost);
  const otherChanges =
    next.category !== existing.category ||
    next.unit !== existing.unit ||
    (next.coverage !== null && !sameDecimal(existing.sqFtPerCarton, next.coverage)) ||
    (next.width !== null && !sameDecimal(existing.widthFt, next.width));
  if (!costChanges && !otherChanges) return null;
  return {
    field: costChanges ? "cost" : "unit",
    message: `${existing.sku} has stock history, so its cost, category, selling unit, coverage and roll width stay as they are. Leave them as they are or leave the row out.`,
  };
}

/**
 * Products (spec G1; ADR 0057 S-18): matched on SKU. The supplier must already be in the app
 * (import suppliers first) and match exactly one supplier. Price and cost are per sq ft for area
 * goods, as on the product screen; a file in sq yd or cartons is converted. A new SKU that a
 * deleted product held is refused, because SKUs stay unique across deleted products (S-6).
 */
function resolveProduct(row: ParsedRow, ctx: KindContext): RowOutcome {
  const sku = text(row, "sku");
  const match = matchSku(sku, ctx);
  if ("problem" in match) return { problems: [match.problem] };
  const existing = match.product;
  if (!existing && ctx.lookups.retiredSkus.has(skuKey(sku))) {
    return refuse("sku", `SKU “${sku}” belonged to a deleted product. Use another SKU.`);
  }
  const supplierKey = text(row, "supplier");
  const found = findParty(ctx.lookups.suppliers, supplierKey);
  if ("none" in found) return refuse("supplier", `No supplier matches “${supplierKey}”. Import suppliers first.`);
  if ("many" in found) {
    return refuse("supplier", ambiguous(found.many, "suppliers", supplierKey, "Use their External ID or email."));
  }
  const supplier = found.one;
  const category = row.category as ProductCategory;
  const fileUnit = row.unit as FileUnit;
  const problems = unitProblems(category, fileUnit, row, existing);
  if (problems.length) return { problems };
  const unit: SellUnit = fileUnit === "sq_yd" || fileUnit === "carton" ? "sq_ft" : fileUnit;
  const coverageCell = row.sq_ft_per_carton as string | null;
  const coverage = coverageCell ?? cartonPack(existing?.sqFtPerCarton);
  const price = pricePerSellUnit(text(row, "price"), fileUnit, coverage);
  const cost = pricePerSellUnit(text(row, "cost"), fileUnit, coverage);
  const size = tooLarge(price, cost);
  if (size) return { problems: [size] };
  // Quantities stay decimal strings, as typed (CLAUDE.md rule 6; whole-product check F-k).
  const width = (row.width_ft as string | null) || null;
  const reorder = (row.reorder_point as string | null) || null;
  if (!existing) {
    const product: Product = {
      id: ctx.newId("prd"),
      sku,
      name: text(row, "name"),
      brand: text(row, "brand"),
      collection: text(row, "collection"),
      colorName: text(row, "color"),
      swatch: NEUTRAL_SWATCH,
      category,
      unit,
      price,
      cost,
      ...(coverageCell ? { sqFtPerCarton: coverageCell } : {}),
      ...(reorder ? { reorderPoint: reorder } : {}),
      ...(width ? { widthFt: width } : {}),
      attributes: {},
      supplierId: supplier.id,
      createdAt: ctx.today,
    };
    return { action: "create", label: sku, writes: [{ collection: "products", record: product }] };
  }
  const frozen = stockHistoryProblem(existing, { cost, category, unit, coverage: coverageCell, width }, ctx);
  if (frozen) return { problems: [frozen] };
  const next = patched(existing, {
    name: text(row, "name"),
    brand: row.brand as string | null,
    collection: row.collection as string | null,
    colorName: row.color as string | null,
    category,
    unit,
    price: keepStored(existing.price, price),
    cost: keepStored(existing.cost, cost),
    sqFtPerCarton: keepStored(existing.sqFtPerCarton, coverageCell),
    reorderPoint: keepStored(existing.reorderPoint, reorder),
    widthFt: keepStored(existing.widthFt, width),
    supplierId: supplier.id,
  });
  if (!next) return { action: "skip", label: sku, writes: [], note: "Nothing changed." };
  return { action: "update", label: sku, writes: [{ collection: "products", record: next }] };
}

/** The products kind. */
export const PRODUCTS: KindHandler = {
  labelField: "sku",
  duplicateKey: (row) => text(row, "sku").toLowerCase(),
  resolve: resolveProduct,
  def: {
    kind: "products",
    label: "Products",
    description: "The catalog: SKU, category, selling unit, price, cost and supplier.",
    module: "core",
    matchOn: "SKU",
    fields: [
      {
        key: "sku",
        label: "SKU",
        type: "text",
        required: true,
        maxLength: 64,
        aliases: ["item", "item number", "product code", "code", "part number"],
        examples: ["RW-5001", "CT-2210"],
      },
      {
        key: "name",
        label: "Name",
        type: "text",
        required: true,
        maxLength: 200,
        aliases: ["product", "product name", "description"],
        examples: ["Harbor Oak Wide Plank", "Brushed Nickel Reducer"],
      },
      {
        key: "brand",
        label: "Brand",
        type: "text",
        maxLength: 100,
        aliases: ["manufacturer", "make"],
        examples: ["Ridgeway", "Cobalt"],
      },
      {
        key: "collection",
        label: "Collection",
        type: "text",
        maxLength: 100,
        aliases: ["series", "line"],
        examples: ["Coastline", "Profiles"],
      },
      {
        key: "color",
        label: "Color",
        type: "text",
        maxLength: 100,
        aliases: ["color name", "colour"],
        examples: ["Harbor Oak", "Brushed Nickel"],
      },
      {
        key: "category",
        label: "Category",
        type: "choice",
        required: true,
        choices: CATEGORY_LABELS,
        aliases: ["product category", "type"],
        examples: ["LVP and LVT", "Adhesives and trims"],
      },
      {
        key: "unit",
        label: "Selling unit",
        type: "choice",
        required: true,
        choices: FILE_UNIT_LABELS,
        aliases: ["unit", "uom", "unit of measure"],
        examples: ["sq ft", "each"],
      },
      {
        key: "price",
        label: "Price",
        type: "money",
        required: true,
        aliases: ["sell price", "unit price", "retail price"],
        examples: ["89.95", "24.50"],
      },
      {
        key: "cost",
        label: "Cost",
        type: "money",
        required: true,
        aliases: ["unit cost", "cost price"],
        examples: ["54.10", "11.20"],
      },
      {
        key: "sq_ft_per_carton",
        label: "Sq ft per carton",
        type: "number",
        unit: "sq ft",
        digits: { whole: 10, decimals: 3 },
        positive: true,
        aliases: ["coverage", "sq ft per box", "sqft per carton"],
        examples: ["23.64", ""],
      },
      {
        key: "width_ft",
        label: "Roll width (ft)",
        type: "number",
        unit: "ft",
        digits: { whole: 10, decimals: 3 },
        positive: true,
        aliases: ["width", "roll width"],
        examples: ["", ""],
      },
      {
        key: "reorder_point",
        label: "Reorder point",
        type: "integer",
        digits: { whole: 10, decimals: 0 },
        aliases: ["reorder", "min stock"],
        examples: ["40", "25"],
      },
      {
        key: "supplier",
        label: "Supplier",
        type: "text",
        required: true,
        maxLength: 320,
        aliases: ["vendor", "supplier name", "supplier id"],
        examples: ["Ridgeway Flooring Supply", "Cobalt Trim Works"],
      },
    ],
  },
};
