import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import { settings, taxJurisdictions, taxRules, type SettingsGroup } from "@workspace/db/company";
import { tenantBranding } from "@workspace/db/control";
import {
  closesOn,
  defaultNumberSettings,
  LOCALIZATION_TABS,
  numbersToWire,
  profileFor,
  readableSections,
  readableTabs,
  SETTINGS_SECTIONS,
  taxBlock,
  taxChanges,
  taxInForce,
  unservedSection,
  type ApiLocalizationTab,
  type ApiSettingsSection,
  type Branding,
  type CompanyProfile,
  type CompanySettings,
  type LocalizationAnswer,
  type LocalizationSettings,
  type LocalizationTabInput,
  type SettingsAnswer,
  type TaxInput,
} from "@workspace/shared";
import { and, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { RequestAccess } from "../../core/access/access.service";
import { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import { CONTROL_DB } from "../../core/database/control-db";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { loadExpenseSettings } from "../finance/expense-records";
import { companyClock, type CompanyClock } from "../sales/sales-common";
import { loadLocalization } from "../sales/sales-records";
import { lockNotAvailable } from "../imports/import-lock";
import {
  BRANDING_COLUMNS,
  brandingAnswer,
  brandingBusy,
  brandingMissing,
  brandingOf,
  readBranding,
} from "./branding-row";

/**
 * A served section stored in the company's `settings` table: every one but Branding, which lives in
 * the control `tenant_branding` row (ADR 0059, part 6, D2).
 */
export type CompanySection = Exclude<ApiSettingsSection, "branding">;

/** How long a branding save waits for the control row's lock before it answers 409 `branding_busy` (part 6). */
export const BRANDING_LOCK_WAIT = "5s";
/** The longest one control statement of a branding save may run (part 6). */
const BRANDING_STATEMENT_LIMIT = "10s";
/** How long a branding save's control transaction may sit idle (waiting for the company database) before the server ends it (part 6). */
const BRANDING_IDLE_LIMIT = "10s";

/** A served section's value as it is stored. */
export type StoredSection<S extends CompanySection> = CompanySettings[S];

/** A company profile that was never saved: every field empty. */
const BLANK_PROFILE: CompanyProfile = {
  legalName: "",
  dba: "",
  ein: "",
  phone: "",
  email: "",
  website: "",
  address: { street: "", city: "", state: "", zip: "" },
};

/**
 * Payments that were never saved, answered the safest way (ADR 0059 D10): every payment waits and
 * nothing can be written off. The API itself refuses payments until the row exists (409).
 */
const NEVER_SAVED_PAYMENTS: CompanySettings["payments"] = {
  approvalRequired: true,
  approvalThreshold: "",
  writeOffMax: "0.00",
  paymentPrefix: "PAY-",
  refundPrefix: "RF-",
};

/**
 * The localization row as the API answers and judges it (ADR 0059, part 2b, D2): Region's time zone
 * is always the company's control zone (`tenants.time_zone`, the zone `companyClock` gives every
 * date the API checks); the row's own copy is never read.
 */
function answered(stored: unknown, zone: string): Partial<LocalizationSettings> {
  // The jsonb row as every loader reads it (`loadLocalization`).
  const localization = stored as Partial<LocalizationSettings>;
  return localization.region ? { ...localization, region: { ...localization.region, timeZone: zone } } : localization;
}

/** The served tabs of a localization row (as `answered` gives it) that `tabs` names (ADR 0059, part 2a). */
function pickTabs(
  localization: Partial<LocalizationSettings>,
  tabs: readonly ApiLocalizationTab[],
): LocalizationAnswer {
  const picked: LocalizationAnswer = {};
  for (const tab of tabs) if (localization[tab] !== undefined) Object.assign(picked, { [tab]: localization[tab] });
  return picked;
}

/**
 * The refusal of a localization tab save when the company has no localization row, or (Region and
 * Currency) a row without that tab: their rules judge the stored tab, so nothing is invented (ADR
 * 0059, part 2a D7; part 2b D11).
 */
export function settingsMissing(): ConflictException {
  return new ConflictException({
    code: "settings_missing",
    message: "Settings → Localization and tax isn't set up for this company yet, so one tab can't be saved on its own.",
  });
}

/**
 * Settings part 1 on the API (ADR 0059): reads the served sections a person may see and saves one
 * section at a time, each in the session's company only (TenantGuard's tenant). Rows are one per
 * group, never soft-deleted, so neither the read nor the lock filters `deleted_at`, the same as the
 * modules that read them (D20). It reads the company's time zone from the control database
 * (`companyClock`, by the verified tenant's id) and never writes it (part 1 D11; part 2b D2). Its one
 * control write is the company's own branding row, by the verified tenant's id (part 6, D2).
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly tenancy: TenantConnectionService,
    private readonly auditLog: AuditService,
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
  ) {}

  /**
   * What `GET /settings` answers this person: each section `readableSections` gives them, the
   * profile through `profileFor` (the EIN only for its manager), the number format as the wire list.
   * One query. The dispatch names every served section and ends in `unservedSection`, so a section
   * it doesn't name is refused before its row is read, never answered under another name (D19).
   * Part 2a adds the localization tabs `readableTabs` gives them, as stored; a company with no
   * localization row gets no `localization` (D7). Region's zone is control's, read once per answer
   * that read the row (part 2b, D2, D15). Sales tax is answered as in force on the company's day:
   * the block with the rules and county rates in force (part 3a, D7); one more read of the row and
   * both tables, only for its readers.
   */
  async answer(tenant: TenantContext, access: RequestAccess): Promise<SettingsAnswer> {
    const sections = readableSections(access);
    const tabs = readableTabs(access);
    if (sections.length === 0 && tabs.length === 0) return {};
    const db = await this.tenancy.db(tenant);
    const companySections = sections.filter((section): section is CompanySection => section !== "branding");
    const groups: SettingsGroup[] = tabs.length > 0 ? [...companySections, "localization"] : companySections;
    const rows = await db
      .select({ group: settings.group, value: settings.value })
      .from(settings)
      .where(inArray(settings.group, groups));
    const stored = new Map(rows.map((row) => [row.group, row.value]));
    const read = <S extends CompanySection>(section: S) => this.valueOf(db, section, stored.get(section));
    const answer: SettingsAnswer = {};
    for (const section of sections) {
      switch (section) {
        case "profile":
          answer.profile = profileFor(await read(section), access.permissions);
          break;
        case "numbers":
          answer.numbers = numbersToWire(await read(section));
          break;
        case "payments":
          answer.payments = await read(section);
          break;
        case "expenses":
          answer.expenses = await read(section);
          break;
        case "branding": {
          // From the control row, by the verified tenant's id; none without a live row (part 6, D6).
          const branding = await readBranding(this.control.db, tenant.companyId);
          if (branding) answer.branding = branding;
          break;
        }
        default:
          throw unservedSection(section);
      }
    }
    const localization = stored.get("localization");
    if (localization !== undefined) {
      const clock = await companyClock(this.control.db, tenant);
      const picked = pickTabs(answered(localization, clock.zone), tabs);
      // Sales tax is never answered as the block alone: with its tables, as in force on the company's day (part 3a, D7).
      if (picked.tax) picked.tax = taxInForce((await loadLocalization(db)).tax, clock.day);
      if (Object.keys(picked).length > 0) answer.localization = picked;
    }
    return answer;
  }

  /** A section as the rules compare against: the stored value, or the value it is answered with when never saved. */
  async current<S extends CompanySection>(tenant: TenantContext, section: S): Promise<StoredSection<S>> {
    const db = await this.tenancy.db(tenant);
    const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.group, section));
    return this.valueOf(db, section, row?.value);
  }

  /**
   * Replaces one section and writes its audit entry, in one transaction (ADR 0059). The row is
   * locked first (`FOR UPDATE`), so two saves of a section run one after the other and each entry's
   * `before` is exactly what its save replaced; the last save wins. `answered` gives the section as
   * the API answers it (the number format as the wire list), which is what the audit records.
   */
  async save<S extends CompanySection>(
    tenant: TenantContext,
    actor: Actor,
    section: S,
    value: StoredSection<S>,
    answered: (value: StoredSection<S>) => unknown,
    guard?: (current: StoredSection<S>) => Promise<void>,
  ): Promise<void> {
    const { label } = SETTINGS_SECTIONS[section];
    const db = await this.tenancy.db(tenant);
    await db.transaction(async (tx) => {
      const row = await this.lockGroup(tx, section);
      // Checks that compare with what is stored run under the row's lock, against the never-saved
      // answer when nothing is (ADR 0059 D10), so two saves at once can't both pass on a stale value.
      if (guard) await guard(await this.valueOf(tx, section, row?.value));
      let id = row?.id;
      if (id) {
        await tx.update(settings).set({ value, updatedAt: new Date() }).where(eq(settings.id, id));
      } else {
        // Two first saves at once both find no row: the unique group index makes the second an update.
        const [saved] = await tx
          .insert(settings)
          .values({ id: uuidv7(), group: section, value, createdBy: actor.access.userId })
          .onConflictDoUpdate({ target: settings.group, set: { value, updatedAt: new Date() } })
          .returning({ id: settings.id });
        id = saved.id;
      }
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "settings",
          action: `Changed ${label.toLowerCase()}`,
          targetType: "settings",
          targetId: id,
          targetLabel: label,
          before: row ? answered(row.value as StoredSection<S>) : null,
          after: answered(value),
        },
        tx,
      );
    });
  }

  /**
   * Replaces one tab of the localization row and writes its audit entry, in one transaction under
   * the row's lock (ADR 0059, parts 2a and 2b). Two people saving different tabs at once keep both
   * changes (the spec's "A section is replaced whole", closed on the API), and each entry's `before`
   * is exactly the tab its save replaced. `settle` gets the tab as the API answers it (Region with
   * control's zone; undefined when the row lacks the tab) and the company's clock. It runs every
   * check that reads the stored tab, so it judges the locked row and never an earlier read (part 2b,
   * D9), and returns what to store, or throws a refusal, which rolls back. A company with no
   * localization row gets 409 (D7); a tab is written into a row that lacks it only when `settle` takes
   * it whole (documents, payroll). Only `[tab]` changes: the other tabs and the stored tax block stay
   * as they were, and the tax tables are never touched. Never writes the control database. Answers
   * what it stored. Sales tax has its own save, which writes its tables (`saveTax`).
   */
  async saveLocalizationTab<T extends Exclude<ApiLocalizationTab, "tax">>(
    tenant: TenantContext,
    actor: Actor,
    tab: T,
    settle: (
      current: LocalizationSettings[T] | undefined,
      clock: CompanyClock,
    ) => LocalizationTabInput[T] | Promise<LocalizationTabInput[T]>,
  ): Promise<LocalizationTabInput[T]> {
    const clock = await companyClock(this.control.db, tenant);
    const db = await this.tenancy.db(tenant);
    return db.transaction(async (tx) => {
      const row = await this.lockGroup(tx, "localization");
      if (!row) throw settingsMissing();
      // The jsonb row as every loader reads it.
      const stored = row.value as Record<string, unknown>;
      const current = answered(row.value, clock.zone)[tab];
      const value = await settle(current, clock);
      await tx
        .update(settings)
        .set({ value: { ...stored, [tab]: value }, updatedAt: new Date() })
        .where(eq(settings.id, row.id));
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "settings",
          action: `Changed ${SETTINGS_SECTIONS.localization.label.toLowerCase()}`,
          targetType: "settings",
          targetId: row.id,
          targetLabel: LOCALIZATION_TABS[tab].label,
          // As answered (Region with control's zone, so a stale copy shows no false zone change).
          before: current ?? null,
          after: value,
        },
        tx,
      );
      return value;
    });
  }

  /**
   * Saves the Sales tax tab (ADR 0059, part 3a) in one transaction under the localization row's
   * lock. It reads every live rule and county rate under the lock, gives `settle` the tab in force on
   * the company's day (`taxInForce`) to run every check against (content, then the step-up), then
   * ends each row the save replaces on the day before and inserts each changed or new row from the
   * company's day (`taxChanges`), a state rule with the next version of its state. A row is never
   * updated except to end it, and never deleted, so an issued invoice's snapshot keeps a rate the
   * tables still hold (blueprint p21 rule 1). The block is stored without the tables. One audit entry,
   * before and after the tab in force. A company without the row, or a row without the block, gets
   * 409. Never writes the control database. Answers the tab now in force, read back.
   */
  async saveTax(
    tenant: TenantContext,
    actor: Actor,
    settle: (current: LocalizationSettings["tax"], clock: CompanyClock) => TaxInput | Promise<TaxInput>,
  ): Promise<LocalizationSettings["tax"]> {
    const clock = await companyClock(this.control.db, tenant);
    const db = await this.tenancy.db(tenant);
    return db.transaction(async (tx) => {
      const row = await this.lockGroup(tx, "localization");
      // The jsonb row as every loader reads it.
      const stored = row?.value as { tax?: unknown } | undefined;
      if (!row || !stored?.tax) throw settingsMissing();
      // Every live row, all versions, read under the lock (D13).
      const all = (await loadLocalization(tx)).tax;
      const current = taxInForce(all, clock.day);
      const next = await settle(current, clock);
      // Every number a state ever used, soft-deleted rows too: the (state, version) unique index counts them.
      const used = await tx
        .select({ state: taxRules.state, version: max(taxRules.version) })
        .from(taxRules)
        .groupBy(taxRules.state);
      const latest = Object.fromEntries(used.map((entry) => [entry.state, entry.version ?? 0]));
      const changes = taxChanges(next, all, clock.day, { latest, makeId: uuidv7 });
      const lastDay = closesOn(clock.day);
      const by = actor.access.userId;
      for (const rule of changes.closedRules) {
        const ended = await tx
          .update(taxRules)
          .set({ validTo: lastDay, updatedAt: new Date() })
          .where(and(eq(taxRules.state, rule.state), eq(taxRules.version, rule.version), isNull(taxRules.deletedAt)))
          .returning({ id: taxRules.id });
        if (ended.length !== 1) throw new Error(`Tax rule ${rule.state} version ${rule.version} could not be ended.`);
      }
      if (changes.openedRules.length > 0)
        await tx
          .insert(taxRules)
          .values(changes.openedRules.map((rule) => ({ id: uuidv7(), ...rule, validTo: null, createdBy: by })));
      const ids = changes.closedJurisdictions.map((rate) => rate.id);
      if (ids.length > 0) {
        const ended = await tx
          .update(taxJurisdictions)
          .set({ validTo: lastDay, updatedAt: new Date() })
          .where(and(inArray(taxJurisdictions.id, ids), isNull(taxJurisdictions.deletedAt)))
          .returning({ id: taxJurisdictions.id });
        if (ended.length !== ids.length) throw new Error("A county rate could not be ended.");
      }
      if (changes.openedJurisdictions.length > 0)
        await tx
          .insert(taxJurisdictions)
          .values(changes.openedJurisdictions.map((rate) => ({ ...rate, validTo: null, createdBy: by })));
      await tx
        .update(settings)
        .set({
          value: { ...(row.value as Record<string, unknown>), tax: taxBlock(changes.after) },
          updatedAt: new Date(),
        })
        .where(eq(settings.id, row.id));
      // What is now in force, read back, so the answer and the audit are what the tables hold (D8).
      const after = taxInForce((await loadLocalization(tx)).tax, clock.day);
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "settings",
          action: `Changed ${SETTINGS_SECTIONS.localization.label.toLowerCase()}`,
          targetType: "settings",
          targetId: row.id,
          targetLabel: LOCALIZATION_TABS.tax.label,
          before: current,
          after,
        },
        tx,
      );
      return after;
    });
  }

  /**
   * Saves Settings → Branding into the company's control `tenant_branding` row (ADR 0059, part 6,
   * D2, D3), approved by the owner on 2026-11-20. One control transaction: the company's live row,
   * found by the verified tenant's id (TenantGuard's, never a body field), is locked (`FOR UPDATE`),
   * so two saves run one after the other and each audit `before` is exactly what its save replaced;
   * a company with no live row gets 409 and nothing is created. Only the name, monogram, color,
   * pattern and theme change: the session timeouts and logo keys in the row never do. The company's
   * `audit_log` row ("Changed branding", before and after as answered) is written in a company
   * transaction inside the control one, so it commits first: no change is ever left unaudited (D3).
   * No transaction spans both databases, so a control commit that fails after the audit committed
   * leaves an audit row for a change not made. Answers the branding as saved, without a logo (D5).
   *
   * The control pool is shared by every tenant's sign-in, so the save never holds a control
   * connection long (part 6, review 2026-11-20): the company database is reached first, before any
   * control connection is taken; inside the control transaction a row lock waits at most
   * `BRANDING_LOCK_WAIT` (then 409 `branding_busy`), a statement runs at most
   * `BRANDING_STATEMENT_LIMIT`, and the server ends a transaction left idle longer than
   * `BRANDING_IDLE_LIMIT` (while it waits for the company database), which rolls it back.
   */
  async saveBranding(tenant: TenantContext, actor: Actor, branding: Branding): Promise<Branding> {
    const db = await this.tenancy.db(tenant);
    // Reach the company database before a control connection is held, so a slow or unreachable
    // company database fails here and never keeps a control connection or the row lock waiting.
    await db.execute(sql`select 1`);
    try {
      return await this.control.db.transaction(async (control) => {
        await control.execute(sql.raw(`set local lock_timeout = '${BRANDING_LOCK_WAIT}'`));
        await control.execute(sql.raw(`set local statement_timeout = '${BRANDING_STATEMENT_LIMIT}'`));
        await control.execute(sql.raw(`set local idle_in_transaction_session_timeout = '${BRANDING_IDLE_LIMIT}'`));
        return this.writeBranding(control, db, tenant, actor, branding);
      });
    } catch (error) {
      if (lockNotAvailable(error)) throw brandingBusy();
      throw error;
    }
  }

  /** The branding save's work inside its control transaction (`saveBranding`): lock, update, audit. */
  private async writeBranding(
    control: ControlDb,
    db: CompanyDb,
    tenant: TenantContext,
    actor: Actor,
    branding: Branding,
  ): Promise<Branding> {
    const [row] = await control
      .select({ id: tenantBranding.id, ...BRANDING_COLUMNS })
      .from(tenantBranding)
      .where(brandingOf(tenant.companyId))
      .for("update");
    if (!row) throw brandingMissing();
    const after = brandingAnswer(branding);
    const { displayName, monogram, brandColor, pattern, defaultTheme } = after;
    await control
      .update(tenantBranding)
      .set({ displayName, monogram, brandColor, pattern, defaultTheme, updatedAt: new Date() })
      .where(eq(tenantBranding.id, row.id));
    await db.transaction((tx) =>
      this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "settings",
          action: `Changed ${SETTINGS_SECTIONS.branding.label.toLowerCase()}`,
          targetType: "settings",
          targetId: row.id,
          targetLabel: SETTINGS_SECTIONS.branding.label,
          before: brandingAnswer(row),
          after,
        },
        tx,
      ),
    );
    return after;
  }

  /** The row of a settings group, locked until the transaction ends: it orders two saves of one group (ADR 0059). */
  private async lockGroup(tx: CompanyDb, group: SettingsGroup): Promise<{ id: string; value: unknown } | undefined> {
    const [row] = await tx
      .select({ id: settings.id, value: settings.value })
      .from(settings)
      .where(eq(settings.group, group))
      .for("update");
    return row;
  }

  /** A stored section, or what a company that never saved it is answered with and acted on (ADR 0059 D10). */
  private async valueOf<S extends CompanySection>(
    db: CompanyDb,
    section: S,
    stored: unknown,
  ): Promise<StoredSection<S>> {
    if (stored !== undefined) return stored as StoredSection<S>;
    const never: { [K in CompanySection]: () => Promise<CompanySettings[K]> } = {
      profile: async () => BLANK_PROFILE,
      numbers: async () => defaultNumberSettings(),
      payments: async () => NEVER_SAVED_PAYMENTS,
      // Exactly how the expense rules read a missing row: approval off.
      expenses: () => loadExpenseSettings(db),
    };
    return (await never[section]()) as StoredSection<S>;
  }
}
