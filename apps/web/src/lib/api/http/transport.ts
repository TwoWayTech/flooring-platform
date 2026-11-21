import { AUTH_BASE_PATH } from "@/lib/session/auth-cookie";
import { ApiError } from "../errors";
import { ReadGate } from "./read-gate";

/** The error body every apps/api endpoint returns (docs/api-contract.md, Conventions). */
interface ErrorBody {
  code?: string;
  message?: string;
}

/** An ApiError from the real API, keeping its machine-readable code and HTTP status. */
export class HttpApiError extends ApiError {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

/** The HTTP verbs apps/api serves. */
type Verb = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** The parts of a request that differ between a JSON call and a file download. */
type RequestBits = Pick<RequestInit, "headers" | "body">;

/** A JSON call's headers and body: only Accept when nothing is sent. */
function jsonInit(body: unknown): RequestBits {
  return body === undefined
    ? { headers: { Accept: "application/json" } }
    : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

/**
 * Refusals that mean the server answered a write and the screen may be stale, so the screens read
 * again (ADR 0051, "Re-reading after every write", 2026-11-16). Not here: status 0 and 502 to 504
 * (the server or gateway is down, so a re-read would fail too, and a screen would drop the dialog
 * holding the input), 401 (the session is gone), 429 (a limit; nothing changed) and 500, as before;
 * a 500 may still have committed, which stays an open note (PR #37).
 */
const ANSWERED_REFUSALS: ReadonlySet<number> = new Set([400, 403, 404, 409, 422]);

/**
 * Calls apps/api with the session cookie and turns every failure into an ApiError, so screens
 * handle a real 403 or 409 exactly as they handle a DemoStore rule error (api-contract.md).
 *
 * It also decides which requests make the screens read again (ADR 0051, "Re-reading after every
 * write", 2026-11-16): every request but a GET is a write, and a write the server answered calls
 * `reread` once, so no routed write can leave a screen showing old data. A POST that only reads
 * goes through `requestAsRead` instead.
 */
export class HttpTransport {
  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
    private readonly reread: () => void = () => undefined,
    private readonly authBaseUrl: string = AUTH_BASE_PATH,
    /** Which list reads the person may make; shared by every copy of this transport. */
    readonly gate: ReadGate = new ReadGate(),
    private readonly inFlight: Map<string, Promise<string | null>> = new Map(),
  ) {}

  /**
   * Sends a JSON request and returns the parsed body; 204 returns undefined. A GET never re-reads.
   * Any other verb re-reads once the server saved it, before its body is parsed (a 2xx whose body
   * fails to parse has still committed), or once it refused it with a status in ANSWERED_REFUSALS.
   */
  async request<T>(method: Verb, path: string, body?: unknown): Promise<T> {
    if (method === "GET" && body === undefined) return this.shared<T>(path);
    if (method === "GET") return this.parse<T>(await this.exchange(method, path, jsonInit(body)));
    let response: Response;
    try {
      response = await this.exchange(method, path, jsonInit(body));
    } catch (failure) {
      if (failure instanceof HttpApiError && ANSWERED_REFUSALS.has(failure.status)) this.answered();
      throw failure;
    }
    this.answered();
    return this.parse<T>(response);
  }

  /**
   * A GET that joins an identical one still in flight instead of sending it again (click-through
   * finding #29): panels of one page that load the same list (locations, customers, GET /company)
   * share one request. Each caller parses its own copy of the body, so no screen sees another's
   * changes. Only requests still waiting are shared, and a write the server answered forgets them
   * (`answered`), so a read made after a write never gets an answer from before it.
   */
  private async shared<T>(path: string): Promise<T> {
    // Keyed by the whole URL: the auth copy of this transport shares the map on another base.
    const url = `${this.baseUrl}${path}`;
    let pending = this.inFlight.get(url);
    if (!pending) {
      const sent = this.exchange("GET", path, jsonInit(undefined)).then((response) =>
        response.status === 204 ? null : response.text(),
      );
      pending = sent.finally(() => {
        if (this.inFlight.get(url) === pending) this.inFlight.delete(url);
      });
      this.inFlight.set(url, pending);
    }
    const text = await pending;
    return (text === null ? undefined : JSON.parse(text)) as T;
  }

  /** A write was answered: later reads start afresh, then the screens read again. */
  private answered(): void {
    this.inFlight.clear();
    this.reread();
  }

  /**
   * A POST that changes nothing a screen shows, or that runs inside a read: it never tells the
   * screens to read again, so a read that sends it can't loop (ADR 0051, 2026-11-16).
   */
  async requestAsRead<T>(method: "POST", path: string, body?: unknown): Promise<T> {
    return this.parse<T>(await this.exchange(method, path, jsonInit(body)));
  }

  /** This transport, with `changed` called after every write the server answered (the router's re-read). */
  withRereads(changed: () => void): HttpTransport {
    return new HttpTransport(this.baseUrl, this.fetcher, changed, this.authBaseUrl, this.gate, this.inFlight);
  }

  /**
   * This transport on Better Auth's endpoints (`/api/auth`), the one route the web host's proxy
   * vouches for with the client IP and its secret; `/api-proxy` refuses auth paths (auth-proxy.ts).
   * Same fetcher and re-reads (ADR 0060).
   */
  auth(): HttpTransport {
    return new HttpTransport(this.authBaseUrl, this.fetcher, this.reread, this.authBaseUrl, this.gate, this.inFlight);
  }

  /** Fetches a stored file's bytes, such as a payment's proof; failures are ApiErrors like any request. */
  async blob(path: string): Promise<Blob> {
    return (await this.exchange("GET", path)).blob();
  }

  /** Sends one request; a failure to reach the server, or an answer that is not OK, throws an HttpApiError. */
  private async exchange(method: Verb, path: string, init: RequestBits = {}): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, { ...init, method, credentials: "include" });
    } catch {
      throw new HttpApiError("The server could not be reached. Check your connection and try again.", 0, "network");
    }
    if (!response.ok) throw await this.errorFrom(response);
    return response;
  }

  /** The answer's JSON body; 204 has none. */
  private async parse<T>(response: Response): Promise<T> {
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  private async errorFrom(response: Response): Promise<HttpApiError> {
    const body = (await response.json().catch(() => ({}))) as ErrorBody;
    return new HttpApiError(
      body.message ?? `Request failed (${response.status}).`,
      response.status,
      body.code ?? "error",
    );
  }
}
