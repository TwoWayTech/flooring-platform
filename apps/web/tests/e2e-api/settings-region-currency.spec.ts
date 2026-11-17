import { expect } from "@playwright/test";
import type { Invoice } from "@workspace/shared";
import { ACCOUNTANT_EMAIL, OWNER_EMAIL, SALES_EMAIL } from "./accounts";
import {
  auditBy,
  auditEntriesBy,
  canonical,
  confirmStepUp,
  expectAuditRows,
  healTab,
  healTabOrThrow,
  putWithStepUp,
  readAs,
} from "./flows/checks";
import { flowTest, formatted, resetAuthAround } from "./flows/kit";

/**
 * Summit's seeded Region and Currency (`packages/shared/fixtures/summit.json`), as
 * `PUT /settings/localization/<tab>` takes them back. The e2e database's control zone is the
 * fixture's (`packages/db/src/seed/control.ts`), so Region's zone is America/Denver. Written out, not
 * imported, so this spec builds on code without part 2b's shared rules.
 */
const SUMMIT_REGION = {
  country: "US",
  primaryState: "CO",
  statesOfOperation: ["CO", "WY"],
  timeZone: "America/Denver",
  locale: "en-US",
  dateFormat: "MMM d, yyyy",
  firstDayOfWeek: "monday",
  fiscalYearStartMonth: 1,
};
const SUMMIT_CURRENCY = { base: "USD", locked: true, extra: [] };
const ACTION = "Changed localization and tax";
const ZONE_MESSAGE = "The company's time zone is set when the company is set up. Ask us to change it.";
const BASE_MESSAGE = "The company's base currency stays USD.";
const CODES_MESSAGE = "Other currencies can't be added, removed or renamed here. Change only their rates.";

/** What these tests read of `GET /settings`, loosely, so the spec builds with or without part 2b's types. */
type Read = {
  localization?: {
    region?: { dateFormat: string; statesOfOperation: string[]; timeZone: string };
    currency?: unknown;
  };
};

/**
 * Settings part 2b on the API (ADR 0059; spec settings-and-permissions.md, Real build, "Settings on
 * the API, part 2b"): Region and Currency read and save through `GET /settings` and
 * `PUT /settings/localization/<tab>`; the time zone is the company's own and read only; a date
 * format change reaches another person's invoice; a change of the states of operation and every
 * Currency save need a code. Each test heals what it changes first, puts it back as its last step,
 * and registers a clean-up that repeats the restore and fails if the API refuses it.
 */
flowTest.describe("Settings part 2b on the API (api mode)", () => {
  flowTest.describe("Region", () => {
    resetAuthAround([OWNER_EMAIL, SALES_EMAIL]);

    flowTest(
      "Z1 Region on the API: the zone is read only and refused, a date format change reaches another person's invoice without a code, and a states change asks for one",
      async ({ personas }) => {
        flowTest.setTimeout(180_000);
        const dana = await personas.open(OWNER_EMAIL, { mfa: true });
        const priya = await personas.open(SALES_EMAIL);
        personas.onCleanup("put Region back", () => healTabOrThrow(dana.request, "region", SUMMIT_REGION, dana.secret));
        expect((await healTab(dana.request, "region", SUMMIT_REGION, dana.secret)).status()).toBe(200);
        const since = Date.now();
        const audited = await auditBy(dana.request, ACTION, "Dana Whitfield", since);
        const regionPut = () =>
          dana.page.waitForResponse(
            (response) =>
              response.request().method() === "PUT" &&
              new URL(response.url()).pathname === "/api-proxy/settings/localization/region",
          );

        // 0. Priya's invoice shows its issued day in Summit's format; `issuedAt` is the company's day.
        const invoice = (await readAs<Invoice[]>(priya.request, "/invoices")).find((each) => each.voidedAt === null);
        expect(invoice, "an invoice of Priya's that isn't void").toBeDefined();
        await priya.page.goto(`/sales/invoices/${invoice!.id}`);
        const article = priya.page.getByRole("article").first();
        await expect(article).toContainText(formatted(invoice!.issuedAt));

        // 1. The time zone is read only on the tab.
        await dana.page.goto("/settings/localization?tab=region");
        const zone = dana.page.getByLabel("Time zone");
        await expect(zone).toBeDisabled();
        await expect(zone).toHaveValue(/America\/Denver/);

        // 2. The API refuses another zone, and still answers the company's.
        const moved = await dana.request.put("/api-proxy/settings/localization/region", {
          data: { ...SUMMIT_REGION, timeZone: "America/New_York" },
        });
        expect(moved.status()).toBe(400);
        expect(await moved.json()).toMatchObject({ code: "invalid_request", message: ZONE_MESSAGE });
        expect((await readAs<Read>(dana.request, "/settings")).localization?.region?.timeZone).toBe("America/Denver");

        // 3. A date format change saves without a code.
        await dana.page.getByLabel("Date format").click();
        await dana.page.getByRole("option", { name: /^\d{4}-\d{2}-\d{2}$/ }).click();
        const saved = regionPut();
        await dana.page.getByRole("button", { name: "Save region" }).click();
        expect((await saved).status()).toBe(200);
        await expect(dana.page.getByText("Region saved")).toBeVisible();
        await expect(dana.page.getByRole("dialog", { name: "Confirm it is you" })).toHaveCount(0);

        // 4. Priya's invoice now reads the API's format; she reads Region but not Currency.
        await priya.page.reload();
        await expect(article).toContainText(invoice!.issuedAt);
        await expect(article).not.toContainText(formatted(invoice!.issuedAt));
        const hers = await readAs<Read>(priya.request, "/settings");
        expect(hers.localization?.region?.dateFormat).toBe("yyyy-MM-dd");
        expect(hers.localization ?? {}).not.toHaveProperty("currency");

        // 5. A change of the states of operation asks for a code.
        await dana.page.getByRole("checkbox", { name: "Wyoming", exact: true }).click();
        const changed = regionPut();
        await dana.page.getByRole("button", { name: "Save region" }).click();
        await expect(dana.page.getByRole("dialog", { name: "Confirm it is you" })).toBeVisible();
        await confirmStepUp(dana.page, dana.secret!);
        expect((await changed).status()).toBe(200);
        await expect(dana.page.getByText("Region saved")).toBeVisible();
        expect((await readAs<Read>(dana.request, "/settings")).localization?.region?.statesOfOperation).toEqual(["CO"]);

        // 6. What Sales isn't offered, the API refuses.
        const denied = await priya.request.put("/api-proxy/settings/localization/region", { data: SUMMIT_REGION });
        expect(denied.status()).toBe(403);
        expect((await denied.json()).code).toBe("forbidden");

        // 7. Put back; three saves audited as Dana (steps 3 and 5, and the restore), each naming Region.
        expect((await healTabOrThrow(dana.request, "region", SUMMIT_REGION, dana.secret)).status()).toBe(200);
        expect(await auditBy(dana.request, ACTION, "Dana Whitfield", since)).toBe(audited + 3);
        const targets = (await auditEntriesBy(dana.request, ACTION, "Dana Whitfield", since)).map((e) => e.target);
        expect(new Set(targets)).toEqual(new Set(["Region"]));
        await expectAuditRows(dana.page, "Region", [ACTION], since);
      },
    );
  });

  flowTest.describe("Currency", () => {
    resetAuthAround([ACCOUNTANT_EMAIL, SALES_EMAIL]);

    flowTest(
      "Z2 Currency on the API: base and codes stay, a valid save always needs a code, and only the key holders read it",
      async ({ personas }) => {
        flowTest.setTimeout(120_000);
        const grace = await personas.open(ACCOUNTANT_EMAIL, { mfa: true });
        const priya = await personas.open(SALES_EMAIL);
        personas.onCleanup("put Currency back", () =>
          healTabOrThrow(grace.request, "currency", SUMMIT_CURRENCY, grace.secret),
        );
        const healed = await healTab(grace.request, "currency", SUMMIT_CURRENCY, grace.secret);
        expect(healed.status()).toBe(200);
        // The heal answers its read of GET /settings when nothing needed saving, else the PUT's answer.
        const healedByPut = new URL(healed.url()).pathname !== "/api-proxy/settings";
        const since = Date.now();
        const audited = await auditBy(grace.request, ACTION, "Grace Liu", since);

        // 1. The tab: no other currencies, and the base currency can't be edited.
        await grace.page.goto("/settings/localization?tab=currency");
        await expect(grace.page.getByText("No other currencies. Bills from abroad are entered in USD.")).toBeVisible();
        await expect(grace.page.getByLabel("Base currency")).toBeDisabled();

        // 2. The base and the codes stay, whatever the step-up says.
        const put = (data: object) => grace.request.put("/api-proxy/settings/localization/currency", { data });
        const base = await put({ ...SUMMIT_CURRENCY, base: "CAD" });
        expect(base.status()).toBe(400);
        expect(await base.json()).toMatchObject({ code: "invalid_request", message: BASE_MESSAGE });
        const added = await put({ ...SUMMIT_CURRENCY, extra: [{ code: "CAD", rate: "1.3870", asOf: "2026-11-04" }] });
        expect(added.status()).toBe(400);
        expect(await added.json()).toMatchObject({ code: "invalid_request", message: CODES_MESSAGE });
        if (!healedByPut) {
          // A valid body needs a code; Grace hasn't stepped up in this run yet.
          const unconfirmed = await put(SUMMIT_CURRENCY);
          expect(unconfirmed.status()).toBe(403);
          expect((await unconfirmed.json()).code).toBe("step_up_required");
        } else {
          flowTest.info().annotations.push({
            type: "skip-step",
            description: "The heal stepped up, so the code refusal isn't observable here (RC9 pins it)",
          });
        }

        // 3. With a code it saves, unchanged.
        const saved = await putWithStepUp(
          grace.request,
          grace.secret!,
          "/settings/localization/currency",
          SUMMIT_CURRENCY,
        );
        expect(saved.status(), await saved.text()).toBe(200);
        const read = await readAs<Read>(grace.request, "/settings");
        expect(canonical(read.localization?.currency)).toBe(canonical(SUMMIT_CURRENCY));

        // 4. Priya reads Region but not Currency, can't save it, and isn't offered the page.
        const hers = await readAs<Read>(priya.request, "/settings");
        expect(hers.localization).toHaveProperty("region");
        expect(hers.localization ?? {}).not.toHaveProperty("currency");
        const denied = await priya.request.put("/api-proxy/settings/localization/currency", { data: SUMMIT_CURRENCY });
        expect(denied.status()).toBe(403);
        expect((await denied.json()).code).toBe("forbidden");
        await priya.page.goto("/settings");
        await expect(priya.page.getByRole("link", { name: "Localization and tax" })).toHaveCount(0);

        // 5. One more save audited as Grace (step 3; a heal in the same minute is in both counts),
        //    naming Currency.
        expect(await auditBy(grace.request, ACTION, "Grace Liu", since)).toBe(audited + 1);
        const targets = (await auditEntriesBy(grace.request, ACTION, "Grace Liu", since)).map((e) => e.target);
        expect(targets).toContain("Currency");
      },
    );
  });
});
