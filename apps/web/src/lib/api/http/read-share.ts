import { ReadGate } from "./read-gate";

/** Whether this runs in a browser; on the server nothing is shared, so no state outlives a request. */
const inBrowser = (): boolean => typeof window !== "undefined";

/** Every browser client's shared reads, so a session change can forget them all (`forgetSharedReads`). */
const shares = new Set<ReadShare>();

/**
 * What every copy of one client's HttpTransport shares (findings #28, #29): the identical GETs still
 * in flight, the person's read gate, and a generation that every session or company change moves on.
 * An in-flight read is keyed by its generation, so a read made after a switch never joins one sent
 * for the company or person before it, and a `GET /company` answer from an older generation is
 * never learned (`isCurrent`).
 */
export class ReadShare {
  readonly gate = new ReadGate();
  private current = 0;
  private readonly inFlight = new Map<string, Promise<string | null>>();

  constructor() {
    if (inBrowser()) shares.add(this);
  }

  /** The generation now: read before a request, compared with `isCurrent` after it. */
  get generation(): number {
    return this.current;
  }

  /** Whether nothing changed the session or company since `generation` was read. */
  isCurrent(generation: number): boolean {
    return generation === this.current;
  }

  /**
   * The in-flight answer for `url`, or `send()`'s once it is started. On the server it always
   * sends, so one rendering request never shares another's answer.
   */
  join(url: string, send: () => Promise<string | null>): Promise<string | null> {
    if (!inBrowser()) return send();
    const key = `${this.current} ${url}`;
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const started: Promise<string | null> = send().finally(() => {
      if (this.inFlight.get(key) === started) this.inFlight.delete(key);
    });
    this.inFlight.set(key, started);
    return started;
  }

  /** A write was answered: later reads start afresh. */
  dropInFlight(): void {
    this.inFlight.clear();
  }

  /** The session or company changed: a new generation, no in-flight reads and no known access. */
  forget(): void {
    this.current += 1;
    this.inFlight.clear();
    this.gate.forget();
  }
}

/**
 * Forgets every client's shared reads and access. The auth calls that change the session (sign-in,
 * a company switch, sign-out) call it before and after they are answered, since they don't go
 * through HttpTransport.
 */
export function forgetSharedReads(): void {
  for (const share of shares) share.forget();
}
