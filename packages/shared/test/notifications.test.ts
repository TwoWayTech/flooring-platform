import { describe, expect, it } from "vitest";
import {
  effectiveRule,
  NOTIFICATION_EVENTS,
  notificationEvent,
  renderTemplate,
  sampleValues,
  unknownTokens,
  type NotificationRule,
} from "../src";

describe("notification templates (spec A4, ADR 0020)", () => {
  it("fills tokens and reports the ones without a value", () => {
    const { text, missing } = renderTemplate("Hello {{ customer.name }}, {{invoice.number}}", {
      "customer.name": "Alpine",
    });
    expect(text).toBe("Hello Alpine, ");
    expect(missing).toEqual(["invoice.number"]);
  });

  it("every default template uses only the tokens its event offers", () => {
    for (const event of NOTIFICATION_EVENTS) {
      expect(unknownTokens(event.subject, event), event.key).toEqual([]);
      expect(unknownTokens(event.body, event), event.key).toEqual([]);
    }
  });

  it("refuses a token the event does not offer", () => {
    expect(unknownTokens("{{ employee.payRate }}", notificationEvent("timesheet.decided"))).toEqual([
      "employee.payRate",
    ]);
  });

  it("offers no pay or cost values, and marks commission messages restricted", () => {
    const sensitive = /cost|margin|pay.?rate|credit.?limit|salary|commission.?amount/i;
    for (const event of NOTIFICATION_EVENTS) {
      for (const name of Object.keys(event.variables)) expect(name, event.key).not.toMatch(sensitive);
    }
    expect(notificationEvent("commission.ready").restricted).toBe(true);
  });

  it("uses the company's rule when there is one, else the catalogue", () => {
    const saved = {
      id: "quote.sent",
      enabled: false,
      channels: { email: false, inApp: true },
      subject: "S",
      body: "B",
    };
    expect(effectiveRule("quote.sent", [saved as NotificationRule]).enabled).toBe(false);
    expect(effectiveRule("invoice.sent", [saved as NotificationRule])).toMatchObject({
      enabled: true,
      channels: { email: true },
    });
  });

  it("previews every template with its samples and nothing missing", () => {
    for (const event of NOTIFICATION_EVENTS) {
      expect(renderTemplate(event.body, sampleValues(event)).missing, event.key).toEqual([]);
    }
  });
});
