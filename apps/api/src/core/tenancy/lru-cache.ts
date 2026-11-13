/**
 * A least-recently-used cache with a fixed size. When a new entry pushes the size past the limit,
 * the oldest entry leaves and `onEvict` gets it, so TenantConnectionService can close that
 * company's pool (blueprint P9: "cached clients with LRU"). A Map keeps insertion order, and
 * reading an entry moves it to the end. Small enough that no library is needed.
 */
export class LruCache<K, V> {
  private readonly entries = new Map<K, V>();

  constructor(
    private readonly limit: number,
    private readonly onEvict: (value: V, key: K) => void,
  ) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("An LRU cache needs a limit of at least 1.");
  }

  /** The entry, now marked as the most recently used, or undefined. */
  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  /** Stores the entry as the most recently used, evicting the oldest one when over the limit. */
  set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size <= this.limit) return;
    const [oldestKey, oldestValue] = this.entries.entries().next().value as [K, V];
    this.entries.delete(oldestKey);
    this.onEvict(oldestValue, oldestKey);
  }

  /** Removes every entry and returns them, for closing at shutdown. */
  drain(): V[] {
    const values = [...this.entries.values()];
    this.entries.clear();
    return values;
  }

  /** How many entries the cache holds. */
  get size(): number {
    return this.entries.size;
  }
}
