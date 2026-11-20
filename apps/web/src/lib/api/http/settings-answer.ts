import {
  API_LOCALIZATION_TABS,
  API_SETTINGS_SECTIONS,
  numbersFromWire,
  unservedSection,
  type CompanySettings,
  type LocalizationAnswer,
  type LocalizationSettings,
  type SettingsAnswer,
} from "@workspace/shared";

/**
 * DemoStore's localization with each served tab (API_LOCALIZATION_TABS) the answer holds replaced
 * by the API's (ADR 0059, part 2a). A tab the answer leaves out (the person doesn't read it) keeps
 * DemoStore's copy, which none of that person's screens reads. Every tab is served, all five since
 * part 3a; anything unknown is ignored, so a newer API never widens an older web.
 */
function servedTabs(answer: LocalizationAnswer, demo: LocalizationSettings): LocalizationSettings {
  const merged = { ...demo };
  for (const tab of API_LOCALIZATION_TABS) if (answer[tab]) Object.assign(merged, { [tab]: answer[tab] });
  return merged;
}

/**
 * The settings the screens read in api mode (ADR 0059): DemoStore's, with each section the API
 * serves (API_SETTINGS_SECTIONS) and each served localization tab replaced by the API's answer. A
 * section or tab the answer leaves out (the person has no screen that reads it, or its module or
 * product feature is off) keeps DemoStore's copy, which none of that person's screens reads.
 * Anything else in the answer is ignored, so a newer API never widens an older web. The merge names
 * every served section and ends in `unservedSection`, so a section the API serves can't be left as
 * DemoStore's copy by omission (D19).
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
      case "sharedCosts":
        merged.sharedCosts = answer.sharedCosts ?? demo.sharedCosts;
        break;
      default:
        throw unservedSection(section);
    }
  }
  merged.localization = answer.localization ? servedTabs(answer.localization, demo.localization) : demo.localization;
  return merged;
}
