import { dec, moneyString, pctOf, roundMoney, sum, marginPct, type Dec } from "./money";
import type { SellUnit } from "./units";
import type { Product } from "./types/catalog";
import type { TaxCategory, TaxRule } from "./us-pack/tax";
import type { TaxSource } from "./us-pack/tax-defaults";

/** One line of a quote or invoice. Quantities and prices are decimal strings. */
export interface DocLine {
  id: string;
  productId?: string;
  description: string;
  category: TaxCategory;
  unit: SellUnit;
  quantity: string;
  unitPrice: string;
  /** Cost per selling unit; drives margin, which only users with view_sensitive see. */
  unitCost: string;
  /** Waste allowance already included in the quantity, kept for display. */
  wastePct?: string;
  /** Room ids this line was measured from (quote builder). */
  roomIds?: string[];
  /** The roll a carpet line should be cut from, picked in the quote builder (spec C2). */
  rollId?: string;
  /** Coverage of one carton when the line was written, for the carton hint (spec A1). */
  sqFtPerCarton?: string;
}

/** What the tax engine needs to tax a document. */
export interface TaxContext {
  /** Rule for the job-site state, or undefined when the company does not collect there. */
  rule: TaxRule | undefined;
  /** Customer holds a valid resale or exemption certificate. */
  exempt: boolean;
  /** Round tax on each line or once per invoice (Localization: Sales tax). */
  rounding: "line" | "invoice";
  /** Lump-sum billing makes labor taxable in states that flag it. */
  lumpSum?: boolean;
  /** Where the rate came from, shown under the tax line (spec A5). */
  source?: TaxSource;
}

/** Calculated values of one line. */
export interface LineTotals {
  id: string;
  amount: string;
  taxable: boolean;
  tax: string;
  cost: string;
}

/** Calculated totals of a document; all money values are 2-place strings. */
export interface DocumentTotals {
  lines: LineTotals[];
  materials: string;
  labor: string;
  other: string;
  subtotal: string;
  taxableAmount: string;
  tax: string;
  total: string;
  cost: string;
  margin: string;
  /** Margin percent with full precision. */
  marginPct: string;
  /** The rate actually applied, "0" when nothing is taxed. */
  ratePct: string;
}

/** Line amount: quantity × unit price, rounded to cents once. */
export function lineAmount(line: Pick<DocLine, "quantity" | "unitPrice">): Dec {
  return roundMoney(dec(line.quantity).times(line.unitPrice));
}

/** Whether a line is taxable under the rule (blueprint "Sales tax engine", rules 3 and 4). */
export function isLineTaxable(category: TaxCategory, ctx: TaxContext): boolean {
  if (!ctx.rule || ctx.exempt) return false;
  if (category === "labor" && ctx.lumpSum && ctx.rule.lumpSumLaborTaxable) return true;
  return ctx.rule.taxable[category];
}

/**
 * Totals for a quote or invoice. Total = sum of line amounts + tax, which the reconciliation
 * test checks on every fixture invoice (spec section 4). Rounding happens once, here.
 */
export function computeTotals(lines: readonly DocLine[], ctx: TaxContext): DocumentTotals {
  const rate = ctx.rule && !ctx.exempt ? ctx.rule.ratePct : "0";
  const perLine = lines.map((line) => {
    const amount = lineAmount(line);
    const taxable = isLineTaxable(line.category, ctx);
    const tax = taxable ? roundMoney(pctOf(amount, rate)) : dec(0);
    const cost = roundMoney(dec(line.quantity).times(line.unitCost));
    return { line, amount, taxable, tax, cost };
  });
  const subtotal = sum(perLine.map((l) => l.amount));
  const taxableAmount = sum(perLine.filter((l) => l.taxable).map((l) => l.amount));
  const tax = ctx.rounding === "line" ? sum(perLine.map((l) => l.tax)) : roundMoney(pctOf(taxableAmount, rate));
  const cost = sum(perLine.map((l) => l.cost));
  const byCategory = (cats: TaxCategory[]) =>
    sum(perLine.filter((l) => cats.includes(l.line.category)).map((l) => l.amount));
  return {
    lines: perLine.map((l) => ({
      id: l.line.id,
      amount: moneyString(l.amount),
      taxable: l.taxable,
      tax: moneyString(l.tax),
      cost: moneyString(l.cost),
    })),
    materials: moneyString(byCategory(["material"])),
    labor: moneyString(byCategory(["labor"])),
    other: moneyString(byCategory(["freight", "service"])),
    subtotal: moneyString(subtotal),
    taxableAmount: moneyString(taxableAmount),
    tax: moneyString(tax),
    total: moneyString(subtotal.plus(tax)),
    cost: moneyString(cost),
    margin: moneyString(subtotal.minus(cost)),
    marginPct: marginPct(subtotal, cost).toString(),
    ratePct: taxableAmount.isZero() ? "0" : rate,
  };
}

/** Deposit due on acceptance: a percentage of the total, rounded to cents. */
export function depositAmount(total: string, depositPct: string): string {
  return moneyString(pctOf(total, depositPct));
}

/**
 * Tax category of a catalog product (blueprint "Sales tax engine", rule 1). Goods are
 * materials; service products name their own category (installation is labor, delivery is
 * freight, furniture moving is a service) in `attributes.taxCategory`.
 */
export function productTaxCategory(product: Pick<Product, "category" | "attributes">): TaxCategory {
  if (product.category !== "service") return "material";
  const declared = product.attributes.taxCategory as TaxCategory | undefined;
  return declared ?? "service";
}
