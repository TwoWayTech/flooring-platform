import { CATEGORY_LABELS } from "../../catalog-labels";
import { UNIT_LABELS, type SellUnit } from "../../units";
import type { Product, ProductCategory } from "../../types";
import type { CellProblem } from "../types";
import { findParty, patched, text } from "../lookup";
import type { KindHandler, ParsedRow, PlanContext, RowOutcome } from "../plan";

/** Imported products start with a neutral chip until someone picks a color. */
const NEUTRAL_SWATCH = "#A39A8E";

/** Coverage and width the product's unit needs (spec section 4): cartons need sq ft per carton, broadloom a width. */
function unitProblems(category: ProductCategory, unit: SellUnit, row: ParsedRow, existing?: Product): CellProblem[] {
  const problems: CellProblem[] = [];
  if (unit === "carton" && !row.sq_ft_per_carton && !existing?.sqFtPerCarton && category !== "adhesive_trim") {
    problems.push({ field: "sq_ft_per_carton", message: "Products sold by the carton need the sq ft per carton." });
  }
  if (category === "carpet" && unit === "sq_yd" && !row.width_ft && !existing?.widthFt) {
    problems.push({ field: "width_ft", message: "Broadloom carpet needs its roll width in ft." });
  }
  return problems;
}

/**
 * Products (spec G1): matched on SKU. The supplier must already be in the app (import suppliers
 * first). Price and cost are per selling unit, as on the product screen.
 */
function resolveProduct(row: ParsedRow, ctx: PlanContext): RowOutcome {
  const sku = text(row, "sku");
  const existing = ctx.world.products.find((p) => p.sku.toLowerCase() === sku.toLowerCase());
  const supplierKey = text(row, "supplier");
  const supplier = findParty(ctx.world.suppliers, supplierKey);
  if (!supplier) {
    return {
      problems: [{ field: "supplier", message: `No supplier matches “${supplierKey}”. Import suppliers first.` }],
    };
  }
  const category = row.category as ProductCategory;
  const unit = row.unit as SellUnit;
  const problems = unitProblems(category, unit, row, existing);
  if (problems.length) return { problems };
  const width = row.width_ft ? Number(row.width_ft) : undefined;
  const reorder = row.reorder_point ? Number(row.reorder_point) : undefined;
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
      price: text(row, "price"),
      cost: text(row, "cost"),
      ...(row.sq_ft_per_carton ? { sqFtPerCarton: text(row, "sq_ft_per_carton") } : {}),
      ...(reorder !== undefined ? { reorderPoint: reorder } : {}),
      ...(width !== undefined ? { widthFt: width } : {}),
      attributes: {},
      supplierId: supplier.id,
      createdAt: ctx.today,
    };
    return { action: "create", label: sku, writes: [{ collection: "products", record: product }] };
  }
  const next = patched(existing, {
    name: text(row, "name"),
    brand: row.brand as string | null,
    collection: row.collection as string | null,
    colorName: row.color as string | null,
    category,
    unit,
    price: text(row, "price"),
    cost: text(row, "cost"),
    sqFtPerCarton: row.sq_ft_per_carton as string | null,
    reorderPoint: reorder,
    widthFt: width,
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
        aliases: ["item", "item number", "product code", "code", "part number"],
        examples: ["RW-5001", "CT-2210"],
      },
      {
        key: "name",
        label: "Name",
        type: "text",
        required: true,
        aliases: ["product", "product name", "description"],
        examples: ["Harbor Oak Wide Plank", "Brushed Nickel Reducer"],
      },
      {
        key: "brand",
        label: "Brand",
        type: "text",
        aliases: ["manufacturer", "make"],
        examples: ["Ridgeway", "Cobalt"],
      },
      {
        key: "collection",
        label: "Collection",
        type: "text",
        aliases: ["series", "line"],
        examples: ["Coastline", "Profiles"],
      },
      {
        key: "color",
        label: "Color",
        type: "text",
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
        choices: UNIT_LABELS,
        aliases: ["unit", "uom", "unit of measure"],
        examples: ["carton", "each"],
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
        aliases: ["coverage", "sq ft per box", "sqft per carton"],
        examples: ["23.64", ""],
      },
      {
        key: "width_ft",
        label: "Roll width (ft)",
        type: "number",
        unit: "ft",
        aliases: ["width", "roll width"],
        examples: ["", ""],
      },
      {
        key: "reorder_point",
        label: "Reorder point",
        type: "integer",
        aliases: ["reorder", "min stock"],
        examples: ["40", "25"],
      },
      {
        key: "supplier",
        label: "Supplier",
        type: "text",
        required: true,
        aliases: ["vendor", "supplier name", "supplier id"],
        examples: ["Ridgeway Flooring Supply", "Cobalt Trim Works"],
      },
    ],
  },
};
