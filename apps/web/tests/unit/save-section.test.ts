import { describe, expect, it, vi } from "vitest";
import { PAYMENT_MESSAGES } from "@workspace/shared";
import { DemoRuleError } from "@/lib/api/demo/admin-rules";
import { HttpApiError } from "@/lib/api/http/transport";
import { saveSection } from "@/features/settings/form/save-section";

/** A notifier that records what it was told. */
function notifier() {
  return { success: vi.fn(), error: vi.fn() };
}

const PAYMENTS = {
  approvalRequired: true,
  approvalThreshold: "12.",
  writeOffMax: "5.00",
  paymentPrefix: "PAY-",
  refundPrefix: "RF-",
};

describe("saveSection: a settings save says how it went (ADR 0059 D16)", () => {
  it("SF1 a save that worked says so once and reports true", async () => {
    const notify = notifier();
    const onSave = vi.fn(async () => undefined);
    await expect(saveSection(PAYMENTS, onSave, "Payments", notify)).resolves.toBe(true);
    expect(onSave).toHaveBeenCalledWith(PAYMENTS);
    expect(notify.success).toHaveBeenCalledTimes(1);
    expect(notify.success).toHaveBeenCalledWith("Payments saved");
    expect(notify.error).not.toHaveBeenCalled();
  });

  it("SF2 a refusal, in either mode, shows its own words and never throws", async () => {
    for (const refusal of [
      new DemoRuleError(PAYMENT_MESSAGES.approvalThreshold),
      new HttpApiError(PAYMENT_MESSAGES.approvalThreshold, 400, "invalid_request"),
    ]) {
      const notify = notifier();
      await expect(saveSection(PAYMENTS, async () => Promise.reject(refusal), "Payments", notify)).resolves.toBe(false);
      expect(notify.error).toHaveBeenCalledTimes(1);
      expect(notify.error).toHaveBeenCalledWith(PAYMENT_MESSAGES.approvalThreshold);
      expect(notify.success).not.toHaveBeenCalled();
    }
  });

  it("SF3 any other failure says the section was not saved", async () => {
    const notify = notifier();
    await expect(
      saveSection(PAYMENTS, async () => Promise.reject(new TypeError("boom")), "Payments", notify),
    ).resolves.toBe(false);
    expect(notify.error).toHaveBeenCalledWith("Payments was not saved. Try again.");
    expect(notify.success).not.toHaveBeenCalled();
  });
});
