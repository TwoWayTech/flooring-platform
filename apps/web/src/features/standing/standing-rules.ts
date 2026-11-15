import {
  blocksCompany,
  type BlockingStandingState,
  type CompanyStanding,
  type CompanyStandingState,
} from "@workspace/shared";

/**
 * The state the overlay shows, or null for the shell (docs/specs/platform-admin.md, part 4, "While
 * a page is open"): maintenance, an unavailable database or a locked company cover the page; full
 * use and read only show the shell. No answer yet shows the shell, because the API's guards still
 * refuse every request.
 */
export function overlayState(standing: CompanyStanding | null): BlockingStandingState | null {
  return standing && blocksCompany(standing.state) ? standing.state : null;
}

/**
 * Whether the Owner's banner reads billing again (ADR 0054; critic C1): only when standing moves
 * into full use or read only from another known state. A raw refusal, a first answer or a move
 * into a blocking state never re-reads, so the banner can't loop behind the overlay.
 */
export function bannerReread(prev: CompanyStandingState | null, next: CompanyStandingState | null): boolean {
  return prev !== null && next !== null && prev !== next && !blocksCompany(next);
}

/**
 * A standing re-check queue (spec part 4, "The re-check"): one read in flight, and a call made
 * during it sets one trailing read, however many calls come. A failed read keeps what was known.
 * The returned function resolves once the queue has drained.
 */
export function createRecheck<T>(read: () => Promise<T>, apply: (value: T) => void): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;
  const drain = async () => {
    do {
      again = false;
      try {
        apply(await read());
      } catch {
        // Keep what was known: the API's guards still refuse each request, and the next refusal asks again.
      }
    } while (again);
  };
  return () => {
    if (running) {
      again = true;
      return running;
    }
    running = drain().finally(() => {
      running = null;
    });
    return running;
  };
}
