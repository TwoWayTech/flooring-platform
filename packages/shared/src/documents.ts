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
  /**
   * Cost per selling unit; drives margin. Stored lines always carry it. A browser whose viewer lacks
   * product cost receives lines without it, because the API strips it (CLAUDE.md rule 5);
   * `computeTotals` then treats it as unknown (`ViewedDocLine`).
   */
  unitCost: string;
  /** Waste allowance already included in the quantity, kept for display. */
  wastePct?: string;
  /** Room ids this line was measured from (quote builder). */
  roomIds?: string[];
  /** The roll a carpet line should be cut from, picked in the quote builder (spec C2). */
  rollId?: string;
  /** Coverage of one carton when the line was written, for the carton hint (spec A1). */
  sqFtPerCarton?: string;
  /** Set when this line ships from another warehouse than the document's (spec A2). */
  locationId?: string;
}

/**
 * A document line as its viewer holds it. The API leaves `unitCost` out for anyone without product
 * cost (CLAUDE.md rule 5; SENSITIVE_FIELDS), so a browser may hold lines without it; a null counts
 * the same. Stored lines (DocLine) always carry it.
 */
export type ViewedDocLine = Omit<DocLine, "unitCost"> & { unitCost?: string | null };

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
  /** null when the line's cost was withheld: never a guess (rule 5; sales.md rule 13; ADR 0037, 2026-11-16). */
  cost: string | null;
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
  /**
   * null when any line's cost was withheld: never a partial sum or a guess (rule 5; sales.md rule 13;
   * ADR 0037, 2026-11-16).
   */
  cost: string | null;
  /**
   * null when any line's cost was withheld: never a partial sum or a guess (rule 5; sales.md rule 13;
   * ADR 0037, 2026-11-16).
   */
  margin: string | null;
  /**
   * Margin percent with full precision; null when any line's cost was withheld: never a partial sum
   * or a guess (rule 5; sales.md rule 13; ADR 0037, 2026-11-16).
   */
  marginPct: string | null;
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
 * test checks on every fixture invoice (spec section 4). Rounding happens once, here. Cost and
 * margin are known only when every line carries its cost (sales.md rule 13).
 */
export function computeTotals(lines: readonly ViewedDocLine[], ctx: TaxContext): DocumentTotals {
  const rate = ctx.rule && !ctx.exempt ? ctx.rule.ratePct : "0";
  const perLine = lines.map((line) => {
    const amount = lineAmount(line);
    const taxable = isLineTaxable(line.category, ctx);
    const tax = taxable ? roundMoney(pctOf(amount, rate)) : dec(0);
    // A withheld cost (absent or null) is unknown, never zero: zero would show a 100 % margin
    // (CLAUDE.md rule 5; sales.md rule 13; ADR 0037, 2026-11-16).
    const unitCost = line.unitCost ?? null;
    const cost = unitCost === null ? null : roundMoney(dec(line.quantity).times(unitCost));
    return { line, amount, taxable, tax, cost };
  });
  const subtotal = sum(perLine.map((l) => l.amount));
  const taxableAmount = sum(perLine.filter((l) => l.taxable).map((l) => l.amount));
  const tax = ctx.rounding === "line" ? sum(perLine.map((l) => l.tax)) : roundMoney(pctOf(taxableAmount, rate));
  // All or nothing: a sum of the known costs would understate cost and overstate margin.
  const known = perLine.flatMap((l) => (l.cost === null ? [] : [l.cost]));
  const cost = known.length === perLine.length ? sum(known) : null;
  const byCategory = (cats: TaxCategory[]) =>
    sum(perLine.filter((l) => cats.includes(l.line.category)).map((l) => l.amount));
  return {
    lines: perLine.map((l) => ({
      id: l.line.id,
      amount: moneyString(l.amount),
      taxable: l.taxable,
      tax: moneyString(l.tax),
      cost: l.cost === null ? null : moneyString(l.cost),
    })),
    materials: moneyString(byCategory(["material"])),
    labor: moneyString(byCategory(["labor"])),
    other: moneyString(byCategory(["freight", "service"])),
    subtotal: moneyString(subtotal),
    taxableAmount: moneyString(taxableAmount),
    tax: moneyString(tax),
    total: moneyString(subtotal.plus(tax)),
    cost: cost === null ? null : moneyString(cost),
    margin: cost === null ? null : moneyString(subtotal.minus(cost)),
    marginPct: cost === null ? null : marginPct(subtotal, cost).toString(),
    ratePct: taxableAmount.isZero() ? "0" : rate,
  };
}

/**
 * The cost of a document being stored or posted. Its lines are stored lines, which always carry
 * cost (the server costs request lines from the catalog, `trustedLines`), so a null here means a
 * browser's lines reached a stored document: it fails rather than store a guessed cost (rule 5).
 */
export function storedCost(totals: Pick<DocumentTotals, "cost">): string {
  if (totals.cost === null) throw new Error("A document line has no cost, so the document can't be stored.");
  return totals.cost;
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
