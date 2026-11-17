import { numbersFromWire, type CompanySettings, type SettingsAnswer } from "@workspace/shared";

/**
 * The settings the screens read in api mode (ADR 0059): DemoStore's, with each section the API
 * serves (API_SETTINGS_SECTIONS) replaced by the API's answer. A section the answer leaves out (the
 * person has no screen that reads it, or its module or product feature is off) keeps DemoStore's
 * copy, which none of that person's screens reads. Anything else in the answer is ignored, so a
 * newer API never widens an older web.
 */
export function settingsFromAnswer(answer: SettingsAnswer, demo: CompanySettings): CompanySettings {
  return {
    ...demo,
    profile: answer.profile ?? demo.profile,
    numbers: answer.numbers ? numbersFromWire(answer.numbers) : demo.numbers,
    payments: answer.payments ?? demo.payments,
    expenses: answer.expenses ?? demo.expenses,
  };
}
