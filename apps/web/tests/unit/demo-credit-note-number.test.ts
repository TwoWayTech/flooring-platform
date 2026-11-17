import { describe, expect, it } from "vitest";
import { CREDIT_NOTE_PREFIX, dec, FIRST_CREDIT_NOTE, nextNumber } from "@workspace/shared";
import { issueCreditNote } from "@/lib/api/demo/commission-actions";
import { CompanyDb } from "@/lib/api/demo/company-db";
import type { FileStore } from "@/lib/api/demo/file-store";
import { loadCompanyFixtures } from "@/lib/api/demo/fixtures";
import type { ActionContext } from "@/lib/api/demo/payment-actions";

const noFiles: FileStore = {
  put: async () => undefined,
  get: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
};

describe("demo credit-note numbers (sales.md rule 22; ADR 0059 part 2a review round 1)", () => {
  it("CN1 a credit note is numbered past every CR- number, an invoice's too, as on the API", async () => {
    const fixtures = await loadCompanyFixtures("summit");
    const credited = new Set(fixtures.invoices.map((i) => i.creditForInvoiceId));
    const live = fixtures.invoices.filter((i) => !i.isReturn && !i.voidedAt && !credited.has(i.id));
    const legacy = live[0]!;
    const invoice = live.find((i) => i.id !== legacy.id && dec(i.subtotal).gt(1))!;
    // An invoice holding the number the credit notes alone would take next, as an import or an old
    // prefix could leave one.
    const taken = nextNumber(
      CREDIT_NOTE_PREFIX,
      fixtures.invoices.filter((i) => i.isReturn).map((i) => i.number),
      FIRST_CREDIT_NOTE,
    );
    const renamed = {
      ...fixtures,
      invoices: fixtures.invoices.map((i) => (i.id === legacy.id ? { ...i, number: taken } : i)),
    };
    const ctx: ActionContext = {
      db: new CompanyDb(renamed, fixtures.anchorDate),
      today: fixtures.anchorDate,
      now: `${fixtures.anchorDate}T12:00:00.000Z`,
      actor: fixtures.users[0]!,
      files: noFiles,
      can: async () => true,
      assertCan: async () => undefined,
      audit: () => undefined,
      newId: (kind) => `${kind}-cn1`,
    };
    const note = await issueCreditNote(ctx, invoice.id, { subtotal: "1.00", reason: "One carton returned" });
    expect(note.number).toBe(`${CREDIT_NOTE_PREFIX}${Number(taken.slice(CREDIT_NOTE_PREFIX.length)) + 1}`);
    expect(ctx.db.list("invoices").filter((i) => i.number === note.number)).toHaveLength(1);
  });
});
