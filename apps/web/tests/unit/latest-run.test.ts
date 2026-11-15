import { describe, expect, it } from "vitest";
import { latestRun } from "@/lib/api/latest-run";

/** A read whose answer the test releases by hand, in any order. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe("latestRun (ADR 0051 part 3)", () => {
  it("lets only the newest of several overlapping reads apply its answer", async () => {
    const ticket = latestRun();
    const shown: string[] = [];
    const reads = [deferred<string>(), deferred<string>(), deferred<string>()];
    const runs = reads.map((read) => {
      const isLatest = ticket();
      return read.promise.then((answer) => {
        if (isLatest()) shown.push(answer);
      });
    });

    // The newest read answers first, then the two older ones come back late.
    reads[2]!.resolve("third");
    reads[0]!.resolve("first");
    reads[1]!.resolve("second");
    await Promise.all(runs);
    expect(shown).toEqual(["third"]);

    // A read started after all of them is the newest, until another one starts.
    const isLatest = ticket();
    expect(isLatest()).toBe(true);
    ticket();
    expect(isLatest()).toBe(false);
  });
});
