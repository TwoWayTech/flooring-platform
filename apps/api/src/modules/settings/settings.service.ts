import { Injectable } from "@nestjs/common";
import type { CompanyDb } from "@workspace/db";
import { settings } from "@workspace/db/company";
import {
  defaultNumberSettings,
  numbersToWire,
  profileFor,
  readableSections,
  SETTINGS_SECTIONS,
  type ApiSettingsSection,
  type CompanyProfile,
  type CompanySettings,
  type SettingsAnswer,
} from "@workspace/shared";
import { eq, inArray } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { RequestAccess } from "../../core/access/access.service";
import { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { loadExpenseSettings } from "../finance/expense-records";

/** A served section's value as it is stored. */
export type StoredSection<S extends ApiSettingsSection> = CompanySettings[S];

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
 * Settings part 1 on the API (ADR 0059): reads the served sections a person may see and saves one
 * section at a time, each in the session's company only (TenantGuard's tenant). Rows are one per
 * group, never soft-deleted, so neither the read nor the lock filters `deleted_at`, the same as the
 * modules that read them (D20). It never writes the control database (D11).
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly tenancy: TenantConnectionService,
    private readonly auditLog: AuditService,
  ) {}

  /**
   * What `GET /settings` answers this person: each section `readableSections` gives them, the
   * profile through `profileFor` (the EIN only for its manager), the number format as the wire list.
   * One query.
   */
  async answer(tenant: TenantContext, access: RequestAccess): Promise<SettingsAnswer> {
    const sections = readableSections(access);
    if (sections.length === 0) return {};
    const db = await this.tenancy.db(tenant);
    const rows = await db
      .select({ group: settings.group, value: settings.value })
      .from(settings)
      .where(inArray(settings.group, sections));
    const stored = new Map(rows.map((row) => [row.group, row.value]));
    const answer: SettingsAnswer = {};
    for (const section of sections) {
      const value = await this.valueOf(db, section, stored.get(section));
      if (section === "profile") answer.profile = profileFor(value as CompanyProfile, access.permissions);
      else if (section === "numbers") answer.numbers = numbersToWire(value as CompanySettings["numbers"]);
      else if (section === "payments") answer.payments = value as CompanySettings["payments"];
      else answer.expenses = value as CompanySettings["expenses"];
    }
    return answer;
  }

  /** A section as the rules compare against: the stored value, or the value it is answered with when never saved. */
  async current<S extends ApiSettingsSection>(tenant: TenantContext, section: S): Promise<StoredSection<S>> {
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
  async save<S extends ApiSettingsSection>(
    tenant: TenantContext,
    actor: Actor,
    section: S,
    value: StoredSection<S>,
    answered: (value: StoredSection<S>) => unknown,
  ): Promise<void> {
    const { label } = SETTINGS_SECTIONS[section];
    const db = await this.tenancy.db(tenant);
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ id: settings.id, value: settings.value })
        .from(settings)
        .where(eq(settings.group, section))
        .for("update");
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

  /** A stored section, or what a company that never saved it is answered with and acted on (ADR 0059 D10). */
  private async valueOf<S extends ApiSettingsSection>(
    db: CompanyDb,
    section: S,
    stored: unknown,
  ): Promise<StoredSection<S>> {
    if (stored !== undefined) return stored as StoredSection<S>;
    const never: { [K in ApiSettingsSection]: () => Promise<CompanySettings[K]> } = {
      profile: async () => BLANK_PROFILE,
      numbers: async () => defaultNumberSettings(),
      payments: async () => NEVER_SAVED_PAYMENTS,
      // Exactly how the expense rules read a missing row: approval off.
      expenses: () => loadExpenseSettings(db),
    };
    return (await never[section]()) as StoredSection<S>;
  }
}
