import { branches, locations, products, settings, taxRules, type SettingsGroup } from "@workspace/db/company";
import type { CompanySettings } from "@workspace/shared";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { v7 as uuidv7 } from "uuid";
import type { AuthHarness } from "../auth-harness";

/** The time zone `AuthHarness.provisionCompany` gives a company, so the API's company day is read in it. */
export const BOOTSTRAP_ZONE = "America/Chicago";

/** The payments approval threshold the money tests run under: payments above it wait for a second person. */
export const APPROVAL_THRESHOLD = "500.00";

/** The tile's price and starting cost per sq ft, and its carton. */
export const TILE = { price: "4.5000", cost: "2.1000", sqFtPerCarton: "20" } as const;

/** The carpet's price and cost per sq ft and its roll width in ft. */
export const CARPET = { price: "3.0000", cost: "1.4000", widthFt: "12" } as const;

/** The Colorado rate the one tax rule carries (material taxable, labor and services not). */
export const TAX_RATE_PCT = "8.81";

/**
 * Summit's settings as the shared fixtures hold them, the data the seed writes, and the values Reset to
 * default reads (ADR 0059 D7).
 */
export const SUMMIT_SETTINGS = (
  JSON.parse(
    readFileSync(createRequire(import.meta.url).resolve("@workspace/shared/fixtures/summit.json"), "utf8"),
  ) as { settings: CompanySettings }
).settings;

/**
 * The tile's waste % on a new quote line: the company's default for porcelain tile. Sales may not
 * change it (spec rule 8, `sales.waste.view`), so a quote by Sales must send exactly this.
 */
export const TILE_WASTE_PCT = SUMMIT_SETTINGS.localization.documents.defaultWastePct.porcelain_tile;

/** Summit's pay schedule, which the bootstrapped company keeps: the frequency and the first period's start. */
export const PAY_SCHEDULE = {
  frequency: SUMMIT_SETTINGS.hr.payFrequency,
  anchor: SUMMIT_SETTINGS.hr.payPeriodAnchor,
} as const;

/** What `bootstrapCompany` made, by role. */
export interface BootstrappedCompany {
  branches: [string, string];
  /** One warehouse per branch, the first the default. */
  warehouses: [string, string];
  showroom: string;
  tile: string;
  carpet: string;
  /** A measure visit sold as a catalog service (not stocked, not taxed in Colorado). */
  service: string;
}

/**
 * Summit's Localization (packages/shared fixtures) as a fresh company's settings row: without its
 * tax tables (those are rows of their own) and in the given time zone, the company's own. It stands
 * in for settings at provisioning (G2): with no row, no Localization tab can be saved on its own.
 */
export function localizationRow(zone: string): { group: SettingsGroup; value: unknown } {
  const { region, tax } = SUMMIT_SETTINGS.localization;
  const taxWithoutTables = Object.fromEntries(
    Object.entries(tax).filter(([key]) => key !== "rules" && key !== "jurisdictions"),
  );
  return {
    group: "localization",
    value: { ...SUMMIT_SETTINGS.localization, region: { ...region, timeZone: zone }, tax: taxWithoutTables },
  };
}

/**
 * Summit's settings groups (packages/shared fixtures, the data the seed writes), as a fresh company's
 * settings rows: localization without its tax tables (those are rows of their own) and in the
 * provisioned company's time zone, payments with the money tests' approval threshold. Branding is
 * left out because it lives in the control database, where provisioning already wrote it.
 */
function summitSettings(): { group: SettingsGroup; value: unknown }[] {
  const fixture = SUMMIT_SETTINGS;
  const rows: { group: SettingsGroup; value: unknown }[] = [];
  for (const group of Object.keys(fixture) as (keyof CompanySettings)[]) {
    if (group === "branding") continue;
    if (group === "localization") {
      rows.push(localizationRow(BOOTSTRAP_ZONE));
    } else if (group === "payments") {
      rows.push({ group, value: { ...fixture.payments, approvalThreshold: APPROVAL_THRESHOLD } });
    } else {
      rows.push({ group, value: fixture[group] });
    }
  }
  return rows;
}

/**
 * Gives a newly provisioned company what onboarding can't give it on the API yet (gaps G2 and G3:
 * settings, branches, warehouses, tax rules and products have no create routes), by direct inserts
 * into its throwaway database, as the older integration tests do: two branches each with a
 * warehouse, a showroom, every settings group Summit has, one Colorado tax rule, a boxed tile, a
 * carpet sold by the roll and a measure visit as a service. No stock and no documents, so every money fact afterwards comes through
 * the API and the money equalities can be exact (whole-product check, money integrity). It stands
 * in for settings at provisioning (G2).
 */
export async function bootstrapCompany(harness: AuthHarness, companyId: string): Promise<BootstrappedCompany> {
  const handle = await harness.companyDb(companyId);
  try {
    return await handle.db.transaction(async (tx) => {
      const [denver, boulder] = await tx
        .insert(branches)
        .values([
          { name: "Denver", city: "Denver", state: "CO" },
          { name: "Boulder", city: "Boulder", state: "CO" },
        ])
        .returning();
      const at = (city: string) => ({ street: "1 Main St", city, state: "CO", zip: "80202" });
      const [first, second, showroom] = await tx
        .insert(locations)
        .values([
          {
            name: "Denver warehouse",
            kind: "warehouse" as const,
            branchId: denver!.id,
            address: at("Denver"),
            isDefault: true,
          },
          { name: "Boulder warehouse", kind: "warehouse" as const, branchId: boulder!.id, address: at("Boulder") },
          { name: "Denver showroom", kind: "showroom" as const, branchId: denver!.id, address: at("Denver") },
        ])
        .returning();
      const [tile, carpet, service] = await tx
        .insert(products)
        .values([
          {
            sku: `MT-${uuidv7()}`,
            name: "Slate Tile",
            category: "porcelain_tile" as const,
            unit: "sq_ft" as const,
            price: TILE.price,
            cost: TILE.cost,
            sqFtPerCarton: TILE.sqFtPerCarton,
          },
          {
            sku: `MC-${uuidv7()}`,
            name: "Harbor Carpet",
            category: "carpet" as const,
            unit: "sq_ft" as const,
            price: CARPET.price,
            cost: CARPET.cost,
            widthFt: CARPET.widthFt,
          },
          {
            sku: `MS-${uuidv7()}`,
            name: "Measure visit",
            category: "service" as const,
            unit: "each" as const,
            price: "75.0000",
            cost: "0.0000",
          },
        ])
        .returning();
      await tx.insert(settings).values(summitSettings());
      await tx.insert(taxRules).values({
        state: "CO",
        jurisdiction: "Denver combined",
        ratePct: TAX_RATE_PCT,
        taxable: { material: true, labor: false, freight: false, service: false },
        lumpSumLaborTaxable: true,
        validFrom: "2025-01-01",
        version: 1,
      });
      return {
        branches: [denver!.id, boulder!.id],
        warehouses: [first!.id, second!.id],
        showroom: showroom!.id,
        tile: tile!.id,
        carpet: carpet!.id,
        service: service!.id,
      };
    });
  } finally {
    await handle.close();
  }
}
