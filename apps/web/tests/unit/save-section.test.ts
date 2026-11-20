import { describe, expect, it, vi } from "vitest";
import { EXPENSE_MESSAGES, expenseSettingsProblem, PAYMENT_MESSAGES, paymentSettingsProblem } from "@workspace/shared";
import { DemoRuleError } from "@/lib/api/demo/admin-rules";
import { HttpApiError } from "@/lib/api/http/transport";
import { nextSaveStep, saveSection } from "@/features/settings/form/save-section";

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

describe("nextSaveStep: the shared rule runs before any step-up (ADR 0059 D5, review round 1)", () => {
  it("SF4 a draft its shared rule refuses shows the rule's words and stops, so no step-up code is asked", () => {
    const payments = notifier();
    expect(nextSaveStep(PAYMENTS, paymentSettingsProblem, true, payments)).toBe("refused");
    expect(payments.error).toHaveBeenCalledTimes(1);
    expect(payments.error).toHaveBeenCalledWith(PAYMENT_MESSAGES.approvalThreshold);

    const expenses = notifier();
    const expense = { approvalRequired: true, approvalThreshold: "12." };
    expect(nextSaveStep(expense, expenseSettingsProblem, false, expenses)).toBe("refused");
    expect(expenses.error).toHaveBeenCalledTimes(1);
    expect(expenses.error).toHaveBeenCalledWith(EXPENSE_MESSAGES.approvalThreshold);

    for (const notify of [payments, expenses]) expect(notify.success).not.toHaveBeenCalled();
  });

  it("SF5 a draft the rule passes, or a section with no rule, goes on to the step-up or the save and says nothing yet", () => {
    const notify = notifier();
    const fixed = { ...PAYMENTS, approvalThreshold: "12.00" };
    expect(nextSaveStep(fixed, paymentSettingsProblem, true, notify)).toBe("step-up");
    expect(nextSaveStep(fixed, paymentSettingsProblem, false, notify)).toBe("save");
    expect(nextSaveStep(PAYMENTS, undefined, true, notify)).toBe("step-up");
    expect(nextSaveStep(PAYMENTS, undefined, false, notify)).toBe("save");
    expect(notify.error).not.toHaveBeenCalled();
    expect(notify.success).not.toHaveBeenCalled();
  });
});
