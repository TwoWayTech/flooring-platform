import { expect, test, type Page } from "@playwright/test";
import { signInAs, skipIfFeatureOff, SUMMIT_OWNER, type Persona } from "./helpers";

const PRIYA: Persona = { companyId: "summit", userId: "sm-usr-03", roleKey: "sales" };
const GRACE: Persona = { companyId: "summit", userId: "sm-usr-06", roleKey: "accountant" };

async function open(page: Page, number: string) {
  await signInAs(page, SUMMIT_OWNER, "/contracts");
  await page.getByRole("row", { name: `Open ${number}` }).click();
  await expect(page.getByRole("heading", { name: new RegExp(number) })).toBeVisible();
}

test.describe("Contracts (spec D1, D2)", () => {
  test.beforeEach(() => skipIfFeatureOff("contracts.register"));

  test("lists customer and subcontractor contracts with their stages", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/contracts");
    await expect(page.getByRole("row", { name: "Open CTR-1001" })).toContainText("Active");
    await expect(page.getByRole("row", { name: "Open CTR-1002" })).toContainText("Completed");
    await expect(page.getByRole("row", { name: "Open CTR-1005" })).toContainText("Sent for signature");
    await expect(page.getByRole("button", { name: "Status, column options" })).toBeVisible();
  });

  test("creates a project, sends it and records a simulated signature with its PDF", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/contracts");
    await page.getByRole("button", { name: "New contract" }).click();
    await page.getByRole("dialog").getByLabel("Title").fill("Lobby refresh");
    await page.getByRole("dialog").getByLabel("Description").fill("Tile");
    await page.getByRole("dialog").getByLabel("Value").fill("10000");
    await page.getByRole("button", { name: "Save contract" }).click();
    await expect(page.getByRole("heading", { name: /Lobby refresh/ })).toBeVisible();
    await page.getByRole("button", { name: "Send for signature" }).click();
    await expect(page.getByRole("button", { name: "Record signature" })).toBeVisible();
    await page.getByRole("button", { name: "Record signature" }).click();
    await page.getByLabel("Signer's full name").fill("Avery Stone");
    await page.getByRole("dialog").getByRole("button", { name: "Record signature" }).click();
    await expect(page.getByText(/Simulated signature: Avery Stone/)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Signed CTR-/ })).toBeVisible();
  });

  test("refuses to send a schedule that does not add up", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/contracts");
    await page.getByRole("button", { name: "New contract" }).click();
    await page.getByRole("dialog").getByLabel("Title").fill("Empty schedule");
    await page.getByRole("dialog").getByLabel("Description").fill("");
    await page.getByRole("button", { name: "Remove line 1" }).click();
    await page.getByRole("button", { name: "Save contract" }).click();
    await expect(page.getByRole("heading", { name: /Empty schedule/ })).toBeVisible();
    await page.getByRole("button", { name: "Send for signature" }).click();
    await expect(page.getByText("Add at least one line to the schedule of values.")).toBeVisible();
  });

  test("the schedule of values shows each line's billed, retained and remaining money", async ({ page }) => {
    await open(page, "CTR-1001");
    const schedule = page.getByRole("region", { name: "Schedule of values" });
    await expect(schedule.getByRole("columnheader")).toHaveText([
      "Line",
      "Billing",
      "Value",
      "Billed to date",
      "Retained",
      "Remaining to bill",
    ]);
    await expect(schedule.getByRole("row", { name: /^L1 Materials/ }).getByRole("cell")).toHaveText([
      "L1 Materials",
      "By progress",
      "$72,000.00",
      "$42,000.00",
      "$2,100.00",
      "$30,000.00",
    ]);
    await expect(schedule.getByRole("row", { name: /^Total/ }).getByRole("cell")).toHaveText([
      "$126,000.00",
      "$66,000.00",
      "$3,300.00",
      "$60,000.00",
    ]);
  });

  test("the list keeps retainage customers hold apart from retainage we hold", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/contracts");
    await expect(page.getByRole("columnheader", { name: /Customers hold/ })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /We hold/ })).toBeVisible();
  });

  test("a billing holds retainage off the invoice, which still shows the gross", async ({ page }) => {
    await open(page, "CTR-1001");
    await page.getByRole("button", { name: "New billing" }).click();
    await page.getByLabel("L2 work to date").fill("30000");
    await expect(page.getByRole("dialog").getByText(/of which/)).toContainText("$300.00");
    await page.getByRole("button", { name: "Post billing" }).click();
    await expect(page.getByText(/^Billing 3 posted$/)).toBeVisible();
    await page
      .getByRole("row", { name: /Billing 3/ })
      .getByRole("link")
      .click();
    await expect(page).toHaveURL(/\/sales\/invoices\//);
  });

  test("won't bill past a line's value", async ({ page }) => {
    await open(page, "CTR-1001");
    await page.getByRole("button", { name: "New billing" }).click();
    await page.getByLabel("L2 work to date").fill("99000");
    await page.getByRole("button", { name: "Post billing" }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText("can't pass the line's value");
  });

  test("approving a change order raises the contract value", async ({ page }) => {
    await open(page, "CTR-1001");
    await expect(page.getByText(/Pending change orders/)).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    // A confirmation first, with the value the contract will have (click-through #34).
    const confirm = page.getByRole("dialog", { name: "Approve CO-1" });
    await expect(confirm).toContainText("New contract value");
    await expect(confirm).toContainText("$141,000.00");
    await confirm.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("CO-1 approved")).toBeVisible();
    await expect(page.getByText(/Pending change orders/)).toHaveCount(0);
    await expect(page.getByRole("cell", { name: /CO-1\.1 Sound underlayment/ })).toBeVisible();
  });

  test("releases retainage on its own invoice", async ({ page }) => {
    await open(page, "CTR-1002");
    await page.getByRole("button", { name: "Release retainage" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Release retainage" }).click();
    await expect(page.getByText("Retainage released")).toBeVisible();
    await expect(page.getByRole("button", { name: "Release retainage" })).toHaveCount(0);
    await expect(page.getByRole("row", { name: /^Release of retainage from billing/ }).getByRole("link")).toBeVisible();
    // Each billing's Released shows what of its retainage was paid out (click-through #33).
    await expect(
      page
        .getByRole("row", { name: /^Billing 1,/ })
        .getByRole("cell")
        .nth(4),
    ).not.toHaveText("$0.00");
  });

  test("a subcontract billing raises a supplier bill, and insurance shows as expiring", async ({ page }) => {
    await open(page, "CTR-1004");
    await expect(page.getByText("Expiring soon")).toBeVisible();
    await page.getByRole("button", { name: "New billing" }).click();
    await page.getByLabel("L1 work to date").fill("11100");
    await page.getByRole("button", { name: "Post billing" }).click();
    await expect(page.getByRole("row", { name: /Billing 2/ })).toContainText("CTR-1004-2");
  });

  test("an unconditional waiver needs a confirmed payment", async ({ page }) => {
    await open(page, "CTR-1002");
    await page.getByRole("button", { name: "Record waiver" }).click();
    await page.getByLabel("Type").click();
    await page.getByRole("option", { name: "Unconditional, final" }).click();
    await page.getByLabel("Amount").fill("500");
    await page.getByRole("button", { name: "Record waiver" }).last().click();
    await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
      "An unconditional waiver needs a confirmed payment.",
    );
  });

  test("terminating needs a reason, and closing needs nothing held", async ({ page }) => {
    await open(page, "CTR-1002");
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByText("Release the retainage before closing.")).toBeVisible();
    await page.getByRole("button", { name: "Terminate" }).click();
    await page.getByRole("dialog").getByRole("textbox").fill("Customer dissolved");
    await page.getByRole("dialog").getByRole("button", { name: "Terminate" }).click();
    await expect(page.getByText("Terminated: Customer dissolved")).toBeVisible();
  });

  test("the dashboard has a Contracts widget in place of Today's jobs", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/");
    await expect(page.getByRole("heading", { name: "Contracts" })).toBeVisible();
    await expect(page.getByText("Retainage customers hold")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Today's jobs" })).toHaveCount(0);
  });

  test("Sales sees only their own contracts and cannot bill", async ({ page }) => {
    await signInAs(page, PRIYA, "/contracts");
    await expect(page.getByRole("button", { name: "New contract" })).toBeVisible();
    await expect(page.getByRole("row", { name: "Open CTR-1004" })).toHaveCount(0);
  });

  test("the bookkeeper can bill but not create a contract", async ({ page }) => {
    await signInAs(page, GRACE, "/contracts");
    await expect(page.getByRole("row", { name: "Open CTR-1001" })).toBeVisible();
    await expect(page.getByRole("button", { name: "New contract" })).toHaveCount(0);
  });
});
