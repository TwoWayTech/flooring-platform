import { products } from "@workspace/db/company";
import { productUndoProblem, type Product } from "@workspace/shared";
import { eq, sql } from "drizzle-orm";
import { loadProducts } from "../inventory/inventory-records";
import { lockStock } from "../inventory/stock-lock";
import { loadSuppliers } from "../purchasing/purchasing-records";
import { liveSupplierIds, loadProductsWithStock, loadRetiredSkus } from "./import-records";
import { byChangeKey, idsOf, type KindStore, type RecordKind } from "./kind-store";

/**
 * The product columns an import writes (ADR 0057 M2, S-18): the loader reads a missing supplier as
 * "", so it goes back as null, and a missing coverage, width or reorder point is null. A JS number
 * round-trips exactly, since the field digit caps keep it under 15 significant digits. The SKU is
 * written only on create; the swatch, attributes and external ID are never changed by an import.
 */
export function productRow(product: Product) {
  return {
    name: product.name,
    brand: product.brand,
    collection: product.collection,
    colorName: product.colorName,
    category: product.category,
    unit: product.unit,
    price: product.price,
    cost: product.cost,
    sqFtPerCarton: product.sqFtPerCarton ?? null,
    reorderPoint: product.reorderPoint ?? null,
    widthFt: product.widthFt ?? null,
    supplierId: product.supplierId || null,
  };
}

const PRODUCT: RecordKind = { noun: "product", targetType: "product", table: "products" };

/**
 * Products (ADR 0057 api 4.7, S-18). The stock lock comes first, as receipts, transfers,
 * corrections and invoices take it before they change stock or average cost, so no movement or
 * roll can appear while an import or Undo decides on stock history (S-5, M4).
 */
export const PRODUCT_STORE: KindStore = {
  async lock(tx) {
    await lockStock(tx);
    await tx.execute(sql`lock table products in share row exclusive mode`);
  },

  async world(tx) {
    return {
      products: await loadProducts(tx),
      suppliers: await loadSuppliers(tx),
      retiredSkus: await loadRetiredSkus(tx),
      productsWithStock: await loadProductsWithStock(tx),
    };
  },

  async write(tx, change, actorId) {
    const after = change.after as Product;
    if (change.before === null) {
      await tx.insert(products).values({
        ...productRow(after),
        id: after.id,
        sku: after.sku,
        swatch: after.swatch,
        attributes: {},
        createdBy: actorId,
      });
      return;
    }
    await tx.update(products).set(productRow(after)).where(eq(products.id, after.id));
  },

  async current(tx, changes) {
    const ids = new Set(idsOf(changes, "products"));
    return byChangeKey(
      "products",
      (await loadProducts(tx)).filter((product) => ids.has(product.id)),
    );
  },

  createdParts: () => [],

  /**
   * An updated product can't be put back once it has stock history and the import changed what
   * stock is valued at, or when its earlier supplier is gone (ADR 0057 M4, M6): the shared rule,
   * with the stock facts read now, under the stock lock.
   */
  async undoProblem(tx, changes) {
    const updated = changes.filter((change) => change.collection === "products" && change.before !== null);
    if (updated.length === 0) return null;
    const stocked = await loadProductsWithStock(tx);
    const live = await liveSupplierIds(tx);
    const facts = { hasStock: (id: string) => stocked.has(id), supplierLive: (id: string) => live.has(id) };
    for (const change of updated) {
      const problem = productUndoProblem(change, facts);
      if (problem) return problem;
    }
    return null;
  },

  async undo(tx, change) {
    if (change.before === null) {
      await tx
        .update(products)
        .set({ deletedAt: sql`now()` })
        .where(eq(products.id, change.id));
      return;
    }
    const before = change.before as Product;
    await tx.update(products).set(productRow(before)).where(eq(products.id, before.id));
  },

  record: () => PRODUCT,

  shape(_collection, record) {
    const product = record as Product;
    return {
      sku: product.sku,
      name: product.name,
      category: product.category,
      unit: product.unit,
      price: product.price,
      cost: product.cost,
      sqFtPerCarton: product.sqFtPerCarton ?? null,
      widthFt: product.widthFt ?? null,
      reorderPoint: product.reorderPoint ?? null,
      supplierId: product.supplierId || null,
    };
  },
};
