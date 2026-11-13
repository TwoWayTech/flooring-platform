import { describe, expect, it } from "vitest";
import { LruCache } from "../src/core/tenancy/lru-cache";

describe("LruCache (P9: one pool per company, oldest closed first)", () => {
  it("evicts the least recently used entry and hands it to onEvict", () => {
    const evicted: string[] = [];
    const cache = new LruCache<string, string>(2, (value) => evicted.push(value));
    cache.set("a", "pool-a");
    cache.set("b", "pool-b");
    expect(cache.get("a")).toBe("pool-a");
    cache.set("c", "pool-c");
    expect(evicted).toEqual(["pool-b"]);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.size).toBe(2);
  });

  it("replaces an entry without evicting another", () => {
    const evicted: string[] = [];
    const cache = new LruCache<string, string>(2, (value) => evicted.push(value));
    cache.set("a", "one");
    cache.set("b", "two");
    cache.set("a", "three");
    expect(evicted).toEqual([]);
    expect(cache.get("a")).toBe("three");
  });

  it("drains every entry for shutdown and refuses a limit below 1", () => {
    const cache = new LruCache<string, number>(3, () => undefined);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.drain()).toEqual([1, 2]);
    expect(cache.size).toBe(0);
    expect(() => new LruCache<string, number>(0, () => undefined)).toThrow();
  });
});
