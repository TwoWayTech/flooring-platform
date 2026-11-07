import type { CompanySeed } from "./companies";
import { Rng } from "./random";

/** Shared state while one company's fixtures are generated. */
export class GenContext {
  readonly rng: Rng;
  private readonly counters = new Map<string, number>();

  constructor(
    readonly company: CompanySeed,
    readonly anchor: string,
  ) {
    this.rng = new Rng(company.seed);
  }

  /** Next stable id for a kind of record, e.g. `sm-inv-0007`. */
  id(kind: string): string {
    const n = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, n);
    return `${this.company.idPrefix}-${kind}-${String(n).padStart(4, "0")}`;
  }

  /** A street address in one of the company's places. */
  address(place = this.rng.pick(this.company.places)) {
    return {
      street: this.rng.faker.location.streetAddress(),
      city: place.city,
      state: place.state,
      zip: `${place.zipPrefix}${String(this.rng.int(1, 99)).padStart(2, "0")}`,
    };
  }
}
