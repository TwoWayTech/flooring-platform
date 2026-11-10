import { expect, test, type Page } from "@playwright/test";
import * as XLSX from "xlsx";
import { FLOW_TAG, HARBOR_OWNER, HR_TAG, signInAs, signInAsPlatformAdmin, SUMMIT_OWNER } from "./helpers";

const CUSTOMERS_CSV = [
  "Account Number,Customer Name,E-mail,Phone,Terms,Credit limit",
  "CUST-9001,Maple Row Builders,orders@maplerow.example,(303) 555-0142,Net 30,25000",
  "CUST-9002,Granite Peak Homes,ap@granitepeak.example,(719) 555-0107,Net 30,15000.00",
  "CUST-9003,Bad Row Supply,not-an-email,(720) 555-0188,Net 30,lots",
].join("\n");

/** Uploads a file to the wizard's file step. */
async function upload(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await page.getByLabel(/Choose a CSV or Excel file/).setInputFiles({ name, mimeType, buffer });
}

/** Opens the wizard and picks the kind, landing on the file step. */
async function startImport(page: Page, kind: string) {
  await page.getByRole("radio", { name: kind, exact: true }).check();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: `File: ${kind.toLowerCase()}` })).toBeVisible();
}

test.describe("data import (spec G1)", () => {
  test(
    "imports customers from CSV, reports the bad row and undoes the batch (flow 4)",
    { tag: FLOW_TAG },
    async ({ page }) => {
      await signInAs(page, SUMMIT_OWNER, "/settings/import");
      await startImport(page, "Customers");
      await upload(page, "customers.csv", "text/csv", Buffer.from(CUSTOMERS_CSV));
      await expect(page.getByText(/customers\.csv: 3 rows and 6 columns/)).toBeVisible();
      await page.getByRole("button", { name: "Next" }).click();

      // Headers were matched by name, aliases included.
      await expect(page.getByRole("combobox", { name: "Name" })).toHaveText("Customer Name");
      await expect(page.getByRole("combobox", { name: "External ID" })).toHaveText("Account Number");
      await expect(page.getByRole("combobox", { name: "Email" })).toHaveText("E-mail");
      await page.getByRole("button", { name: "Check the file" }).click();

      await expect(page.getByText("Creates 2, updates 0, skips 0; 1 row has errors and is left out.")).toBeVisible();
      await expect(page.getByText("Email: “not-an-email” is not an email address.")).toBeVisible();
      await expect(page.getByText("Credit limit: “lots” is not an amount. Write it like 1250.00.")).toBeVisible();
      await page.getByRole("button", { name: "Import 2 rows" }).click();

      await expect(page.getByText(/^IMP-1001 imported from customers\.csv$/)).toBeVisible();
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download error report" }).click();
      expect((await download).suggestedFilename()).toBe("IMP-1001-errors.csv");

      await page.goto("/sales?view=customers");
      await page.getByLabel("Search customers").fill("Maple Row");
      await expect(page.getByText("Maple Row Builders")).toBeVisible();

      await page.goto("/settings/import");
      const history = page.getByRole("region", { name: "Import history" });
      await expect(history.getByRole("row", { name: /IMP-1001.*Customers.*customers\.csv/ })).toBeVisible();
      await history.getByRole("button", { name: "Undo IMP-1001" }).click();
      await page.getByRole("dialog", { name: "Undo IMP-1001?" }).getByRole("button", { name: "Undo import" }).click();
      await expect(page.getByText("IMP-1001 undone")).toBeVisible();
      await page.goto("/sales?view=customers");
      await page.getByLabel("Search customers").fill("Maple Row");
      await expect(page.getByText("Maple Row Builders")).toHaveCount(0);
    },
  );

  test("a second import updates instead of duplicating, with the saved columns", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/import");
    await startImport(page, "Customers");
    await upload(
      page,
      "customers.csv",
      "text/csv",
      Buffer.from("Client,Ref,Mail\nMaple Row Builders,CUST-9001,a@maple.example"),
    );
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Choose the column for Name.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Check the file" })).toBeDisabled();
    await page.getByRole("combobox", { name: "Name" }).click();
    await page.getByRole("option", { name: "Client" }).click();
    await page.getByRole("combobox", { name: "External ID" }).click();
    await page.getByRole("option", { name: "Ref" }).click();
    await page.getByRole("combobox", { name: "Email" }).click();
    await page.getByRole("option", { name: "Mail" }).click();
    await page.getByRole("button", { name: "Check the file" }).click();
    await page.getByRole("button", { name: "Import 1 row" }).click();
    await page.getByRole("button", { name: "Import another file" }).click();

    await upload(page, "customers.csv", "text/csv", Buffer.from("Client,Ref,Mail\nMaple Row Flooring,CUST-9001,"));
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("combobox", { name: "External ID" })).toHaveText("Ref");
    await page.getByRole("button", { name: "Check the file" }).click();
    await expect(page.getByText("Creates 0, updates 1, skips 0.")).toBeVisible();
  });

  test("reads an Excel workbook in the worker and flags unknown suppliers per cell", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/import");
    await startImport(page, "Products");
    const sheet = XLSX.utils.aoa_to_sheet([
      ["SKU", "Name", "Category", "Selling unit", "Price", "Cost", "Sq ft per carton", "Supplier"],
      ["XL-100", "Harbor Oak Wide Plank", "LVP and LVT", "carton", 89.95, 54.1, 23.64, "Nobody Supply"],
    ]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Products");
    const buffer = Buffer.from(XLSX.write(book, { bookType: "xlsx", type: "buffer" }) as Uint8Array);
    await upload(page, "products.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer);
    await expect(page.getByText(/products\.xlsx, sheet Products: 1 row and 8 columns/)).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Check the file" }).click();
    await expect(
      page.getByText("Supplier: No supplier matches “Nobody Supply”. Import suppliers first."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^Import/ })).toBeDisabled();
  });

  test("offers both templates", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/import");
    await startImport(page, "Rolls and stock");
    for (const [button, file] of [
      ["CSV template", "rolls-and-stock-template.csv"],
      ["Excel template", "rolls-and-stock-template.xlsx"],
    ] as const) {
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: button }).click();
      expect((await download).suggestedFilename()).toBe(file);
    }
  });

  test("the platform admin imports for a company from Platform admin → Company", async ({ page }) => {
    await signInAsPlatformAdmin(page, "/admin/companies/summit");
    await page.getByRole("navigation", { name: "Company pages" }).getByRole("link", { name: "Data import" }).click();
    await expect(page.getByRole("heading", { name: "Summit Floor Co.", level: 1 })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Open customer invoices" })).toBeVisible();
    await page.goto("/admin/companies/harbor/import");
    await expect(page.getByRole("radio")).toHaveCount(1);
    await expect(page.getByRole("radio", { name: "Employees" })).toBeVisible();
  });

  test("simulates a database connection and keeps nothing", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/settings/database");
    await expect(page.getByRole("note")).toContainText(
      "Live database connections run on the server in the full product.",
    );
    await page.getByLabel("Host").fill("legacy-db.example.internal");
    await page.getByLabel("Database", { exact: true }).fill("floorshop");
    await page.getByLabel("Read-only user").fill("report_reader");
    await page.getByLabel("Password").fill("not-kept");
    await page.getByRole("button", { name: "Test connection" }).click();
    await expect(page.getByText("Connected to floorshop: 5 tables found")).toBeVisible();
    await expect(page.getByLabel("Password")).toHaveValue("");
    await expect(page.getByRole("combobox", { name: "What dbo.Customers becomes" })).toHaveText("Customers");
    await page.getByRole("button", { name: "Preview rows" }).first().click();
    await expect(page.getByRole("cell", { name: "Maple Row Builders" })).toBeVisible();
    const stored = await page.evaluate(() => JSON.stringify(localStorage));
    expect(stored).not.toContain("not-kept");
    expect(stored).not.toContain("legacy-db.example.internal");
  });

  test("the HR Suite imports employees", { tag: HR_TAG }, async ({ page }) => {
    await signInAs(page, HARBOR_OWNER, "/settings/import");
    await expect(page.getByRole("radio")).toHaveCount(1);
    await startImport(page, "Employees");
    await upload(
      page,
      "people.csv",
      "text/csv",
      Buffer.from("Name,Email,Pay rate,State\nJordan Reyes,jordan.reyes@work.example,28.50,Colorado"),
    );
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Check the file" }).click();
    await page.getByRole("button", { name: "Import 1 row" }).click();
    await expect(page.getByText(/^IMP-1001 imported from people\.csv$/)).toBeVisible();
    await page.goto("/hr/employees");
    await page.getByLabel("Search people").fill("Jordan Reyes");
    await expect(page.getByText("Jordan Reyes", { exact: true })).toBeVisible();
  });
});
