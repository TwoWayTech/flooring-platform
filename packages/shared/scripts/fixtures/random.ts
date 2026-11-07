import { Faker, en } from "@faker-js/faker";
import { dec } from "../../src/money";

/**
 * Seeded randomness for the fixture generator. Every company gets its own Faker with a fixed
 * seed, so the output is identical on every run (CLAUDE.md rule 5).
 */
export class Rng {
  readonly faker: Faker;

  constructor(seed: number) {
    this.faker = new Faker({ locale: [en] });
    this.faker.seed(seed);
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return this.faker.number.int({ min, max });
  }

  /** True with the given probability (0 to 1). */
  chance(probability: number): boolean {
    return this.faker.number.float({ min: 0, max: 1 }) < probability;
  }

  /** One element of a non-empty list. */
  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)]!;
  }

  /** `count` distinct elements, in random order. */
  sample<T>(items: readonly T[], count: number): T[] {
    return this.faker.helpers.shuffle([...items]).slice(0, count);
  }

  /** Index chosen with the given relative weights. */
  weightedIndex(weights: readonly number[]): number {
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = this.faker.number.float({ min: 0, max: total });
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i]!;
      if (roll <= 0) return i;
    }
    return weights.length - 1;
  }

  /** Amount in [min, max] with exact cents, as a 2-place decimal string. */
  money(min: number, max: number): string {
    return dec(this.int(Math.round(min * 100), Math.round(max * 100)))
      .dividedBy(100)
      .toFixed(2);
  }

  /** Decimal in [min, max] with the given places, as a string. */
  decimal(min: number, max: number, places: number): string {
    const scale = 10 ** places;
    return dec(this.int(Math.round(min * scale), Math.round(max * scale)))
      .dividedBy(scale)
      .toFixed(places);
  }

  /** A person's full name. */
  personName(): string {
    return `${this.faker.person.firstName()} ${this.faker.person.lastName()}`;
  }

  /** A US-style phone number in a fixed, readable format. */
  phone(areaCode: string): string {
    return `(${areaCode}) ${this.int(200, 989)}-${String(this.int(0, 9999)).padStart(4, "0")}`;
  }
}

/** Lower-case email on a reserved example domain, so no real mailbox is ever used. */
export function emailFor(name: string, domain: string): string {
  const local = name
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .trim()
    .replace(/\s+/g, ".");
  return `${local}@${domain}`;
}
