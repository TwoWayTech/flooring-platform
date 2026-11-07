import { dateShift, shiftDates, type CompanyFixtures, type CompanySettings, type DateShift } from "@workspace/shared";
import type { CollectionName, Collections, ItemOf } from "../contract";
import { readStored, writeStored } from "./storage";

/** Changes the presenter made to one company, kept in localStorage (spec section 1). */
interface CompanyOverlay {
  shift: DateShift;
  settings: CompanySettings | null;
  records: Partial<Record<CollectionName, Record<string, unknown>>>;
}

const emptyOverlay = (shift: DateShift): CompanyOverlay => ({ shift, settings: null, records: {} });

/**
 * One company's data: generated fixtures moved to today, plus the presenter's overlay. Lists
 * keep fixture order; records added in the demo come last.
 */
export class CompanyDb {
  private readonly base: CompanyFixtures;
  private readonly overlay: CompanyOverlay;
  private readonly cache = new Map<CollectionName, unknown[]>();

  constructor(fixtures: CompanyFixtures, today: string) {
    const shift = dateShift(fixtures.anchorDate, today);
    this.base = shiftDates(fixtures, shift);
    this.overlay = CompanyDb.loadOverlay(fixtures.companyId, shift);
  }

  /** Reads the stored overlay, moving its dates when the demo is opened on a later day. */
  private static loadOverlay(companyId: string, shift: DateShift): CompanyOverlay {
    const stored = readStored<CompanyOverlay>(companyId);
    if (!stored) return emptyOverlay(shift);
    const delta = { days: shift.days - stored.shift.days, weeks: shift.weeks - stored.shift.weeks };
    return { ...shiftDates({ settings: stored.settings, records: stored.records }, delta), shift };
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
