import { ApiError } from "../errors";

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

/**
 * Calls apps/api with the session cookie and turns every failure into an ApiError, so screens
 * handle a real 403 or 409 exactly as they handle a DemoStore rule error (api-contract.md).
 */
export class HttpTransport {
  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
  ) {}

  /** Sends a JSON request and returns the parsed body; 204 returns undefined. */
  async request<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        credentials: "include",
        headers: body === undefined ? { Accept: "application/json" } : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new HttpApiError("The server could not be reached. Check your connection and try again.", 0, "network");
    }
    if (!response.ok) throw await this.errorFrom(response);
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
