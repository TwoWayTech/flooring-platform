import { DemoRuleError } from "./demo/admin-rules";
import { HttpApiError } from "./http/transport";

/**
 * Whether trying the same request again could succeed (click-through #12). A refusal cannot: a
 * broken rule from DemoStore, or an API answer of 400 to 499 (invalid input, no permission, gone,
 * a conflict, a broken rule, the session ended), except 408 and 429, which pass with time. A
 * failure to reach the server, a 5xx or the presenter's simulated offline network can.
 */
export function retryCanHelp(failure: unknown): boolean {
  if (failure instanceof DemoRuleError) return false;
  if (failure instanceof HttpApiError) {
    const refused = failure.status >= 400 && failure.status < 500;
    return !refused || failure.status === 408 || failure.status === 429;
  }
  return true;
}

/**
 * The options of an error toast: a "Try again" action only when a retry could help, so a toast
 * never offers a button that fails the same way (click-through #12). Pass them to `toast.error`.
 */
export function retryToast(failure: unknown, retry: () => void): { action?: { label: string; onClick: () => void } } {
  return retryCanHelp(failure) ? { action: { label: "Try again", onClick: retry } } : {};
}
