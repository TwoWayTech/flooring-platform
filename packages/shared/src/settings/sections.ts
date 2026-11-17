import { featureOn, type FeatureKey } from "../features";
import { NUMBER_KINDS, type NumberKind, type NumberSettings } from "../numbers";
import type { PermissionKey } from "../permissions/catalog";
import type { ModuleKey } from "../products";
import type { CompanyProfile, CompanySettings, ExpenseSettings, PaymentSettings } from "../types/settings";

/**
 * Who may save one settings section and where it lives (spec settings-and-permissions.md rule 7;
 * ADR 0059): any one of `keys` saves it; `feature` is the switch of the page that saves it, and a
 * save answers "not found" while it is off; a company without `module` is refused; `label` names
 * the section in the audit log ("Changed <label in lower case>", target `<label>`).
 */
export interface SettingsSectionRule {
  keys: readonly [PermissionKey, ...PermissionKey[]];
  feature: FeatureKey;
  module: ModuleKey;
  label: string;
}

/**
 * Every settings section's page, key, switch, module and audit label: the one table the API's
 * guards and DemoStore read (CLAUDE.md rule 4; spec rule 7). Payments is in `core` although its key
 * is a `platform` key: the payments feature belongs to Flooring, and `/settings/accounting` takes
 * the same key with module `core` (ADR 0040).
 */
export const SETTINGS_SECTIONS = {
  branding: {
    keys: ["settings.branding.manage"],
    feature: "settings.branding",
    module: "platform",
    label: "Branding",
  },
  /**
   * Any one of the two keys saves the whole section in the demo: the demo's whole-section rule. API
   * routes go per tab (part 2: `settings.localization.manage`; part 3: `settings.tax.manage`) and
   * must not use these keys together.
   */
  localization: {
    keys: ["settings.localization.manage", "settings.tax.manage"],
    feature: "settings.localization",
    module: "platform",
    label: "Localization and tax",
  },
  numbers: {
    keys: ["settings.numbers.manage"],
    feature: "settings.number-format",
    module: "platform",
    label: "Number format",
  },
  profile: {
    keys: ["settings.company.manage"],
    feature: "settings.company",
    module: "platform",
    label: "Company profile",
  },
  payments: { keys: ["settings.payments.manage"], feature: "sales.payments", module: "core", label: "Payments" },
  inventory: {
    keys: ["settings.locations.manage"],
    feature: "inventory.locations",
    module: "core",
    label: "Stock rules",
  },
  expenses: {
    keys: ["settings.expenses.manage"],
    feature: "finance.expenses",
    module: "core",
    label: "Expense approval",
  },
  sharedCosts: {
    keys: ["settings.expenses.manage"],
    feature: "finance.expenses",
    module: "core",
    label: "Shared costs",
  },
  hr: { keys: ["settings.hr.manage"], feature: "settings.hr", module: "hr", label: "HR" },
  meetings: { keys: ["settings.meetings.manage"], feature: "settings.meetings", module: "meetings", label: "Meetings" },
  email: {
    keys: ["settings.notifications.manage"],
    feature: "settings.notifications",
    module: "platform",
    label: "Email and notifications",
  },
} as const satisfies Readonly<Record<keyof CompanySettings, SettingsSectionRule>>;

/**
 * The sections the API reads and writes (ADR 0059). Each later part adds its section here and to
 * `SETTINGS_READERS`, and the web routes it with no other change; every other section stays on
 * DemoStore in api mode until then.
 */
export const API_SETTINGS_SECTIONS = ["profile", "numbers", "payments", "expenses"] as const;

/** A section the API serves. */
export type ApiSettingsSection = (typeof API_SETTINGS_SECTIONS)[number];

/** Whether the API serves a section (ADR 0059), so the web sends it there. */
export function isApiSettingsSection(section: string): section is ApiSettingsSection {
  return (API_SETTINGS_SECTIONS as readonly string[]).includes(section);
}

/**
 * Who reads a served section: everyone, or holders of any listed key. `hiddenWhenOff` is set when
 * the section's feature is a product feature: while it is off, every screen that reads it is hidden.
 */
export interface SettingsReadRule {
  readers: "everyone" | readonly PermissionKey[];
  hiddenWhenOff: boolean;
}

/**
 * Who `GET /settings` answers each section to (ADR 0059 D3), by the screens that read it:
 * - `profile` and `numbers`: every member, for every document and every number on screen. Their
 *   page switches gate only the save, because the rest of the app reads them whatever the page says.
 * - `payments`: the invoice page (`sales.invoice.view`), for the payment sheet's approval line and
 *   Update status's write-off, and the Payments page.
 * - `expenses`: only Settings → Expenses reads it.
 *
 * A screen added later that reads a section for someone not listed here must add its key, or in
 * api mode it gets DemoStore's copy. The server's own payment and expense checks read the stored
 * rows whatever is answered here.
 */
export const SETTINGS_READERS: Readonly<Record<ApiSettingsSection, SettingsReadRule>> = {
  profile: { readers: "everyone", hiddenWhenOff: false },
  numbers: { readers: "everyone", hiddenWhenOff: false },
  payments: { readers: ["sales.invoice.view", "settings.payments.manage"], hiddenWhenOff: true },
  expenses: { readers: ["settings.expenses.manage"], hiddenWhenOff: true },
};

/** What `readableSections` needs to know about the reader: their effective keys and the company's modules. */
export interface SettingsReader {
  permissions: ReadonlySet<PermissionKey>;
  modules: readonly ModuleKey[];
}

/**
 * The served sections a person reads, in `API_SETTINGS_SECTIONS` order (ADR 0059 D3, D9): its
 * module is on, the person is one of its readers, and, for a product feature's section, that
 * feature is on. `on` is the switch register, a parameter so tests can switch one off.
 */
export function readableSections(
  reader: SettingsReader,
  on: (key: FeatureKey) => boolean = featureOn,
): ApiSettingsSection[] {
  return API_SETTINGS_SECTIONS.filter((section) => {
    const { module, feature } = SETTINGS_SECTIONS[section];
    const { readers, hiddenWhenOff } = SETTINGS_READERS[section];
    if (!reader.modules.includes(module)) return false;
    if (readers !== "everyone" && !readers.some((key) => reader.permissions.has(key))) return false;
    return !hiddenWhenOff || on(feature);
  });
}

/**
 * The company profile as a person may read it (ADR 0059 D3): the EIN only for holders of
 * `settings.company.manage`. No screen but Company profile reads the EIN, and documents don't print it.
 */
export function profileFor(profile: CompanyProfile, permissions: ReadonlySet<PermissionKey>): CompanyProfile {
  return permissions.has("settings.company.manage") ? profile : { ...profile, ein: "" };
}

/** Why a settings save is refused below company-wide data scope (ADR 0059 D4): settings bind the whole company. */
export const SETTINGS_SCOPE_MESSAGE = "Company settings cover the whole company.";

/**
 * The number format as it travels (ADR 0059 D6): the decimals as a list of kinds, because
 * `unitCost` is a reserved name in `SENSITIVE_FIELDS`, so a `decimals.unitCost` property would be
 * stripped for anyone without product cost. Stored rows keep `NumberSettings`.
 */
export type NumberSettingsWire = Omit<NumberSettings, "decimals"> & {
  decimals: { kind: NumberKind; places: number }[];
};

const KINDS = Object.keys(NUMBER_KINDS) as NumberKind[];

/** The number format as it travels: every kind once, in `NUMBER_KINDS` order. */
export function numbersToWire(settings: NumberSettings): NumberSettingsWire {
  return {
    decimals: KINDS.map((kind) => ({ kind, places: settings.decimals[kind] })),
    negativeStyle: settings.negativeStyle,
    compactDashboards: settings.compactDashboards,
    locale: settings.locale,
    currency: settings.currency,
  };
}

/**
 * The number format from its wire form, read tolerantly for a screen: a kind this build doesn't
 * know is dropped, and a missing kind, or one with places that are not a whole number, takes its
 * default. The API's own write checks the list strictly before it gets here.
 */
export function numbersFromWire(wire: NumberSettingsWire): NumberSettings {
  const given = new Map<string, number>();
  for (const entry of wire.decimals) if (!given.has(entry.kind)) given.set(entry.kind, entry.places);
  const placesOf = (kind: NumberKind) => {
    const places = given.get(kind);
    return Number.isInteger(places) ? places! : NUMBER_KINDS[kind].default;
  };
  return {
    decimals: Object.fromEntries(KINDS.map((kind) => [kind, placesOf(kind)])) as Record<NumberKind, number>,
    negativeStyle: wire.negativeStyle,
    compactDashboards: wire.compactDashboards,
    locale: wire.locale,
    currency: wire.currency,
  };
}

/**
 * What `GET /settings` answers (ADR 0059): each served section the person reads. A section is left
 * out when `readableSections` leaves it out.
 */
export interface SettingsAnswer {
  profile?: CompanyProfile;
  numbers?: NumberSettingsWire;
  payments?: PaymentSettings;
  expenses?: ExpenseSettings;
}
