import { isPermissionKey, mayReadList, type ListReadPath, type PermissionKey } from "@workspace/shared";

/**
 * Which list reads the signed-in person may make, from the effective permissions in every
 * `GET /company` answer (`access.permissions`, the guard's own; ADR 0051, "GET /company"). A screen
 * that loads a module's data asks only for the lists the person's role can read, so normal
 * navigation sends no request the API would refuse (click-through finding #28). The rule is the
 * shared one the API's PermissionGuard applies (`mayReadList`, `holdsAny`).
 *
 * Until an answer is known (sign-in, a company switch) every read goes out, as before: the API
 * still decides, and a refused list reads as empty. Keys this build doesn't know are dropped.
 */
export class ReadGate {
  private held: ReadonlySet<PermissionKey> | null = null;

  /**
   * Keeps the person's effective permissions from a `GET /company` answer. Only in a browser: on the
   * server the client is one module for every rendering request, so it never keeps a person's access.
   */
  learn(permissions: readonly string[]): void {
    if (typeof window === "undefined") return;
    this.held = new Set(permissions.filter((key) => isPermissionKey(key)));
  }

  /** Drops them when the company changes or closes, so another company's access never applies. */
  forget(): void {
    this.held = null;
  }

  /** Whether to send a list read: yes until the permissions are known, then only what they allow. */
  allows(path: ListReadPath): boolean {
    return this.held === null || mayReadList(path, this.held);
  }
}
