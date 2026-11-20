import { featureOn, type FeatureKey } from "../features";
import { NUMBER_KINDS, type NumberKind, type NumberSettings } from "../numbers";
import type { PermissionKey } from "../permissions/catalog";
import type { ModuleKey } from "../products";
import type { Branding } from "../types/company";
import type {
  CompanyProfile,
  CompanySettings,
  ExpenseSettings,
  LocalizationSettings,
  PaymentSettings,
} from "../types/settings";

/**
 * Who may save one settings section and where it lives (spec settings-and-permissions.md rule 7;
 * ADR 0059): any one of `keys` saves it (Localization and tax's two keys only reach its refusal: it
 * saves one tab at a time, `LOCALIZATION_TABS`; part 3b); `feature` is the switch of the page that
 * saves it, and a save answers "not found" while it is off; a company without `module` is refused;
 * `label` names the section in the audit log ("Changed <label in lower case>", target `<label>`).
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
   * Localization and tax saves one tab at a time, each with its own key (`LOCALIZATION_TABS`), on
   * screens, in DemoStore and on the API. These keys only decide who reaches the whole-section
   * refusal: `updateSettings("localization")` and `resetSettings("localization")` check the module,
   * either key, the switch and scope, then refuse with `LOCALIZATION_SECTION_MESSAGE` (spec rule 7;
   * ADR 0059, part 3b, D35). The label names every tab's audit entry and the feature is every tab's switch.
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
export const API_SETTINGS_SECTIONS = ["profile", "numbers", "payments", "expenses", "branding"] as const;

/** A section the API serves. */
export type ApiSettingsSection = (typeof API_SETTINGS_SECTIONS)[number];

/** Whether the API serves a section (ADR 0059), so the web sends it there. */
export function isApiSettingsSection(section: string): section is ApiSettingsSection {
  return (API_SETTINGS_SECTIONS as readonly string[]).includes(section);
}

/**
 * The error of a dispatch over the served sections that reaches a section it doesn't name: the API's
 * answer and the web merge end their `switch` with it (ADR 0059, part 2a, D19). Its `never`
 * parameter makes the typecheck refuse a dispatch that leaves out a section of
 * `API_SETTINGS_SECTIONS`; a section that gets past the types fails here, instead of being answered
 * under another section's name or left as DemoStore's copy.
 */
export function unservedSection(section: never): Error {
  return new Error(`GET /settings has no answer for "${String(section)}".`);
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
 * - `branding`: every member: the shell paints every screen with its color, pattern and theme and
 *   shows its name and monogram, and invoices, receipts and purchase orders print it (part 6, D6).
 *   Its page switch gates only the save. The API answers it from the control `tenant_branding` row.
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
  branding: { readers: "everyone", hiddenWhenOff: false },
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
  return API_SETTINGS_SECTIONS.filter((section) =>
    isReadable(SETTINGS_SECTIONS[section], SETTINGS_READERS[section], reader, on),
  );
}

/**
 * Whether a person reads a served section or tab: its module is on, they are one of its readers,
 * and, when a product feature's switch hides every screen that reads it, that switch is on.
 */
function isReadable(
  rule: Pick<SettingsSectionRule, "module" | "feature">,
  read: SettingsReadRule,
  reader: SettingsReader,
  on: (key: FeatureKey) => boolean,
): boolean {
  if (!reader.modules.includes(rule.module)) return false;
  if (read.readers !== "everyone" && !read.readers.some((key) => reader.permissions.has(key))) return false;
  return !read.hiddenWhenOff || on(rule.feature);
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
  /**
   * From the control `tenant_branding` row (ADR 0059, part 6, D6); left out when the company has no
   * live row. `logoDataUrl` is always null on the API: the monogram stands in for a logo (D5).
   */
  branding?: Branding;
  /**
   * Present only when the company has saved localization and the person reads at least one served
   * tab (`readableTabs`); each tab as stored (ADR 0059, part 2a), except that Region's time zone is
   * the company's control zone (`tenants.time_zone`), not the stored copy (part 2b).
   */
  localization?: LocalizationAnswer;
}

// Settings, part 2a (ADR 0059): Localization and tax and the Sales and documents page save one tab
// at a time, each with exactly one key.

/** Who may save one tab of Localization and tax: a section rule with exactly one key (spec rule 7; ADR 0059 part 2a). */
export type LocalizationTabRule = Omit<SettingsSectionRule, "keys"> & { keys: readonly [PermissionKey] };

const LOCALIZATION = SETTINGS_SECTIONS.localization;

/**
 * Who may save each tab of Localization and tax and the Sales and documents page, the switch of its
 * page (the section's), the module whose absence refuses the save, and the audit target (ADR 0059,
 * part 2a). Each tab has exactly one key: the API's `PUT /settings/localization/<tab>` and
 * DemoStore's `updateLocalization` check one tab at a time and never the section's any-of (spec
 * rule 7). Sales and documents numbers and prints quotes, invoices and purchase orders, so it is
 * Flooring's (`core`); the overtime rule drives timesheets and pay, so Payroll rules are HR's (`hr`);
 * Region and Currency are `platform`: every company of both products has them (part 2b). Sales tax
 * is `platform` too: every company database has its tables; an HR Suite company's rules drive
 * nothing, because it issues no quotes or invoices (part 3a, D5).
 */
export const LOCALIZATION_TABS = {
  region: {
    keys: ["settings.localization.manage"],
    feature: LOCALIZATION.feature,
    module: "platform",
    label: "Region",
  },
  currency: {
    keys: ["settings.localization.manage"],
    feature: LOCALIZATION.feature,
    module: "platform",
    label: "Currency",
  },
  tax: { keys: ["settings.tax.manage"], feature: LOCALIZATION.feature, module: "platform", label: "Sales tax" },
  payroll: {
    keys: ["settings.localization.manage"],
    feature: LOCALIZATION.feature,
    module: "hr",
    label: "Payroll rules",
  },
  documents: {
    keys: ["settings.localization.manage"],
    feature: LOCALIZATION.feature,
    module: "core",
    label: "Sales and documents",
  },
} as const satisfies Readonly<Record<keyof LocalizationSettings, LocalizationTabRule>>;

/**
 * The tabs the API reads and writes (ADR 0059). Part 2b adds `region` and `currency`; part 3a adds
 * `tax`, so every tab is served. Each also needs a `LOCALIZATION_READERS` row; the web merges and
 * routes it with no other change.
 */
export const API_LOCALIZATION_TABS = ["documents", "payroll", "region", "currency", "tax"] as const;

/** A localization tab the API serves. */
export type ApiLocalizationTab = (typeof API_LOCALIZATION_TABS)[number];

/** Whether the API serves a localization tab (ADR 0059, part 2a), so the web sends it there. */
export function isApiLocalizationTab(tab: string): tab is ApiLocalizationTab {
  return (API_LOCALIZATION_TABS as readonly string[]).includes(tab);
}

/**
 * Who `GET /settings` answers each served tab to (ADR 0059, parts 2a D8 and 2b D10), by the screens
 * that read it:
 * - `documents`: the quote builder (deposit, default waste, expiry; `sales.quote.view`), the invoice
 *   page and its receipts (footer; `sales.invoice.view`), the purchase order PDF (footer;
 *   `purchasing.order.view`), and the page itself.
 * - `payroll`: Timesheets (`hr.timesheet.view`, held by every default role), the HR dashboard
 *   (`hr.overview.view`), Settings → HR (`settings.hr.manage`) and the tab.
 * - `region`: every member: every screen's dates (`use-format-date.ts`), the invoice document and
 *   receipts, a new quote's job-site state and the address dialogs (`primaryState`), the quote
 *   builder's tax preview (`statesOfOperation`); its zone is control's (`tenants.time_zone`).
 * - `currency`: only its own tab.
 * - `tax`: the quote builder's tax preview and its job-site state list (`sales.quote.view`) and the
 *   tab (`settings.tax.manage`); answered as in force on the company's day, with its tables (part
 *   3a, D7).
 *
 * Documents, payroll, region and tax are read by other screens whatever the `settings.localization`
 * page switch says; currency is read only on its tab, so it is hidden while the switch is off. A screen
 * added later that reads a tab for someone not listed must add its key, or in api mode it gets
 * DemoStore's copy.
 */
export const LOCALIZATION_READERS: Readonly<Record<ApiLocalizationTab, SettingsReadRule>> = {
  documents: {
    readers: ["sales.quote.view", "sales.invoice.view", "purchasing.order.view", "settings.localization.manage"],
    hiddenWhenOff: false,
  },
  payroll: {
    readers: ["hr.timesheet.view", "hr.overview.view", "settings.hr.manage", "settings.localization.manage"],
    hiddenWhenOff: false,
  },
  region: { readers: "everyone", hiddenWhenOff: false },
  currency: { readers: ["settings.localization.manage"], hiddenWhenOff: true },
  tax: { readers: ["sales.quote.view", "settings.tax.manage"], hiddenWhenOff: false },
};

/**
 * The served localization tabs a person reads, in `API_LOCALIZATION_TABS` order (ADR 0059, parts 2a
 * and 2b): the tab's module is on, the person is one of its readers, and, for a tab hidden while its
 * page is off (Currency), the switch is on. `on` is the switch register, a parameter so tests can
 * switch one off.
 */
export function readableTabs(
  reader: SettingsReader,
  on: (key: FeatureKey) => boolean = featureOn,
): ApiLocalizationTab[] {
  return API_LOCALIZATION_TABS.filter((tab) =>
    isReadable(LOCALIZATION_TABS[tab], LOCALIZATION_READERS[tab], reader, on),
  );
}

/**
 * The localization tabs `GET /settings` answers: each served tab the person reads, as stored (Region
 * with control's zone). Sales tax is the stored block with the rules and county rates in force on
 * the company's day (part 3a).
 */
export type LocalizationAnswer = Partial<Pick<LocalizationSettings, ApiLocalizationTab>>;
