import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { invoiceAfterInstallation, invoiceFromJob, linesFromJob, sum, type CompanyFixtures } from "../src";

const summit = JSON.parse(
  readFileSync(fileURLToPath(new URL("../fixtures/summit.json", import.meta.url)), "utf8"),
) as CompanyFixtures;
const job = summit.jobs.find((j) => j.invoiceId && j.status === "completed")!;
const invoice = summit.invoices.find((i) => i.id === job.invoiceId)!;

describe("installation complete (spec B6)", () => {
  it("makes a held balance due from the completion day and marks the invoice sent", () => {
    const held = { ...invoice, dueAt: null, sentAt: null, sentBy: null };
    expect(invoiceAfterInstallation(held, "2026-11-09", "net_15", "u1")).toMatchObject({
      dueAt: "2026-11-24",
      sentAt: "2026-11-09",
      sentBy: "u1",
    });
    const dated = { ...invoice, dueAt: "2026-10-01" };
    expect(invoiceAfterInstallation(dated, "2026-11-09", "net_15", "u1").dueAt).toBe("2026-10-01");
  });

  it("builds an invoice from a job: materials at catalog price, labor carrying the rest of the revenue", () => {
    let n = 0;
    const lines = linesFromJob(job, summit.products, () => `l${++n}`);
    expect(lines).toHaveLength(job.materials.length + 1);
    expect(lines.at(-1)).toMatchObject({ category: "labor", quantity: "1" });
    const customer = summit.customers.find((c) => c.id === job.customerId)!;
    const made = invoiceFromJob(job, customer, lines, summit.settings.localization, {
      id: "x",
      number: "INV-9999",
      issuedAt: "2026-11-09",
      createdBy: "u1",
      branchId: "b",
      locationId: "l",
    });
    expect(made.subtotal).toBe(sum(lines.map((l) => (Number(l.quantity) * Number(l.unitPrice)).toFixed(2))).toFixed(2));
    expect(made).toMatchObject({ quoteId: null, depositPct: "0", sentAt: null, jobSite: job.address });
  });
});
