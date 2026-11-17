import {
  API_SETTINGS_SECTIONS,
  numbersFromWire,
  unservedSection,
  type CompanySettings,
  type SettingsAnswer,
} from "@workspace/shared";

/**
 * The settings the screens read in api mode (ADR 0059): DemoStore's, with each section the API
 * serves (API_SETTINGS_SECTIONS) replaced by the API's answer. A section the answer leaves out (the
 * person has no screen that reads it, or its module or product feature is off) keeps DemoStore's
 * copy, which none of that person's screens reads. Anything else in the answer is ignored, so a
 * newer API never widens an older web. The merge names every served section and ends in
 * `unservedSection`, so a section the API serves can't be left as DemoStore's copy by omission (D19).
 */
export function settingsFromAnswer(answer: SettingsAnswer, demo: CompanySettings): CompanySettings {
  const merged = { ...demo };
  for (const section of API_SETTINGS_SECTIONS) {
    switch (section) {
      case "profile":
        merged.profile = answer.profile ?? demo.profile;
        break;
      case "numbers":
        merged.numbers = answer.numbers ? numbersFromWire(answer.numbers) : demo.numbers;
        break;
      case "payments":
        merged.payments = answer.payments ?? demo.payments;
        break;
      case "expenses":
        merged.expenses = answer.expenses ?? demo.expenses;
        break;
      default:
        throw unservedSection(section);
    }
  }
  return merged;
}
