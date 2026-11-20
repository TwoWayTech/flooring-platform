import { describe, expect, it } from "vitest";
import { TIMESHEET_CHANGED_MESSAGE } from "@workspace/shared";
import { fakeApi } from "./fake-api";

const EMPLOYEE = "0195f3a2-7b1c-7d4e-8f00-00000000ee01";

/** A saved week as PUT /timesheets answers it: hours as decimal strings (ADR 0046). */
const SAVED = {
  id: "0195f3a2-7b1c-7d4e-8f00-00000000ff01",
  employeeId: EMPLOYEE,
  weekStart: "2026-11-09",
  days: ["8", "7.5", "0", "0", "0", "0", "0"],
  status: "draft",
};

describe("saving a week of hours on the API (ADR 0051, 2026-11-16)", () => {
  it("sends the hours the form started from as decimal strings, beside the hours typed", async () => {
    const { client, sent } = fakeApi({ "PUT /timesheets": { status: 200, body: SAVED } });
    const saved = await client.saveTimesheet({
      employeeId: EMPLOYEE,
      weekStart: "2026-11-09",
      days: [8, 7.5, 0, 0, 0, 0, 0],
      expectedDays: [6.5, 0.25, 0, 0, 0, 0, 0],
    });
    expect(sent).toEqual([
      {
        call: "PUT /timesheets",
        body: {
          employeeId: EMPLOYEE,
          weekStart: "2026-11-09",
          days: ["8", "7.5", "0", "0", "0", "0", "0"],
          expectedDays: ["6.5", "0.25", "0", "0", "0", "0", "0"],
        },
      },
    ]);
    expect(saved.days).toEqual([8, 7.5, 0, 0, 0, 0, 0]);
  });

  it("re-reads once when the hours changed meanwhile, and rejects in the server's words", async () => {
    const { client, changes } = fakeApi({
      "PUT /timesheets": { status: 409, body: { code: "timesheet_changed", message: TIMESHEET_CHANGED_MESSAGE } },
    });
    await expect(
      client.saveTimesheet({ employeeId: EMPLOYEE, weekStart: "2026-11-09", days: [8], expectedDays: [6.5] }),
    ).rejects.toMatchObject({ status: 409, code: "timesheet_changed", message: TIMESHEET_CHANGED_MESSAGE });
    expect(changes()).toBe(1);
  });
});
