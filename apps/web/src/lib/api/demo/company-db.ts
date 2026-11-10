import {
  dateShift,
  overlayFileIds,
  OVERLAY_SCHEMA_VERSION,
  shiftDates,
  upgradeOverlay,
  type CompanyFixtures,
  type CompanySettings,
  type DateShift,
  type StoredOverlay,
} from "@workspace/shared";
import type { CollectionName, Collections, ItemOf } from "../contract";
import { readLegacy, readStored, removeLegacy, writeStored } from "./storage";

/** Changes the presenter made to one company, kept in localStorage (spec section 1). */
interface CompanyOverlay {
  schemaVersion: number;
  shift: DateShift;
  settings: CompanySettings | null;
  records: Partial<Record<CollectionName, Record<string, unknown>>>;
}

/** Shown once when saved changes from an older demo could not be upgraded (plan section 2.3). */
export const UPGRADE_RESET_NOTICE =
  "Your saved demo changes came from an older version of the demo, so this company was reset to fresh data.";

const emptyOverlay = (shift: DateShift): CompanyOverlay => ({
  schemaVersion: OVERLAY_SCHEMA_VERSION,
  shift,
  settings: null,
  records: {},
});

/**
 * One company's data: generated fixtures moved to today, plus the presenter's overlay. Lists
 * keep fixture order; records added in the demo come last.
 */
export class CompanyDb {
  private readonly base: CompanyFixtures;
  private readonly overlay: CompanyOverlay;
  private readonly cache = new Map<CollectionName, unknown[]>();
  /** Set when saved data from an older demo had to be dropped; the store passes it on once. */
  readonly upgradeNotice: string | null;
  /** Uploaded files that belonged to the dropped data; the store removes them. */
  readonly droppedFileIds: string[];

  constructor(fixtures: CompanyFixtures, today: string) {
    const shift = dateShift(fixtures.anchorDate, today);
    this.base = shiftDates(fixtures, shift);
    const { overlay, notice, droppedFileIds } = this.loadOverlay(shift);
    this.overlay = overlay;
    this.upgradeNotice = notice;
    this.droppedFileIds = droppedFileIds;
  }

  /**
   * Reads the stored overlay, moving its dates to today. Data saved by an older version (under
   * the version 1 key, or an older schema under the current key) is dropped with a notice.
   */
  private loadOverlay(shift: DateShift): { overlay: CompanyOverlay; notice: string | null; droppedFileIds: string[] } {
    const id = this.base.companyId;
    const current = readStored<StoredOverlay>(id);
    if (current?.schemaVersion === OVERLAY_SCHEMA_VERSION) {
      return {
        overlay: CompanyDb.moved(current as unknown as CompanyOverlay, shift),
        notice: null,
        droppedFileIds: [],
      };
    }
    const legacy = current ?? readLegacy<StoredOverlay>(id);
    if (!legacy) return { overlay: emptyOverlay(shift), notice: null, droppedFileIds: [] };
    if (!current) removeLegacy(id);
    try {
      const upgraded = upgradeOverlay(legacy) as unknown as CompanyOverlay;
      writeStored(id, upgraded);
      return { overlay: CompanyDb.moved(upgraded, shift), notice: null, droppedFileIds: [] };
    } catch {
      const fresh = emptyOverlay(shift);
      writeStored(id, fresh);
      return { overlay: fresh, notice: UPGRADE_RESET_NOTICE, droppedFileIds: overlayFileIds(legacy) };
    }
  }

  /** The overlay with its dates moved from the day it was saved to today. */
  private static moved(stored: CompanyOverlay, shift: DateShift): CompanyOverlay {
    const delta = {
      days: shift.days - stored.shift.days,
      weeks: shift.weeks - stored.shift.weeks,
      months: shift.months - (stored.shift.months ?? 0),
    };
    const { settings, records } = shiftDates({ settings: stored.settings, records: stored.records }, delta);
    return { schemaVersion: OVERLAY_SCHEMA_VERSION, shift, settings, records };
  }

  get companyId() {
    return this.base.companyId;
  }

  /** The generated settings, before any change made in the demo. */
  get defaultSettings(): CompanySettings {
    return this.base.settings;
  }

  get settings(): CompanySettings {
    return this.overlay.settings ?? this.base.settings;
  }

  set settings(value: CompanySettings) {
    this.overlay.settings = value;
    this.persist();
  }

  /** Every record of a collection, fixtures merged with the overlay. */
  list<K extends CollectionName>(name: K): Collections[K] {
    const cached = this.cache.get(name);
    if (cached) return cached as Collections[K];
    const changes: Record<string, unknown> = this.overlay.records[name] ?? {};
    const base = this.base[name] as { id: string }[];
    const merged = base
      .map((item) => (item.id in changes ? (changes[item.id] as { id: string } | null) : item))
      .filter((item): item is { id: string } => item !== null);
    const known = new Set(base.map((item) => item.id));
    const added = Object.entries(changes)
      .filter(([id, item]) => !known.has(id) && item !== null)
      .map(([, item]) => item as { id: string });
    const result = [...merged, ...added];
    this.cache.set(name, result);
    return result as Collections[K];
  }

  /** One record by id. */
  get<K extends CollectionName>(name: K, id: string): ItemOf<K> | undefined {
    return (this.list(name) as { id: string }[]).find((item) => item.id === id) as ItemOf<K> | undefined;
  }

  /** Creates or replaces a record and stores the change. */
  put<K extends CollectionName>(name: K, item: ItemOf<K>): ItemOf<K> {
    const records: Record<string, unknown> = (this.overlay.records[name] ??= {});
    records[(item as { id: string }).id] = item;
    this.cache.delete(name);
    this.persist();
    return item;
  }

  /** Deletes a record; a fixture record is hidden by a tombstone in the overlay. */
  remove(name: CollectionName, id: string): void {
    const records: Record<string, unknown> = (this.overlay.records[name] ??= {});
    records[id] = null;
    this.cache.delete(name);
    this.persist();
  }

  private persist() {
    writeStored(this.companyId, this.overlay);
  }
}
