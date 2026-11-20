import { API_LOCALIZATION_TABS, API_SETTINGS_SECTIONS } from "@workspace/shared";
import type { ApiClient, CollectionName } from "@/lib/api/contract";
import { API_METHODS } from "@/lib/api/http/api-methods";
import type { HttpTransport } from "@/lib/api/http/transport";
import { insideParens, normalPath, readRepoFile, withoutComments } from "./source";

/**
 * What each ApiClient method in API_METHODS calls on the API (whole-product check, coverage list,
 * ADR 0058). The paths are read from api-methods.ts as text, so a bent path fails CV-4 against the
 * route catalog without a server. `list` and `get` are probed instead: they reach the API only for
 * the collections in its private SERVED_LISTS, so the probe calls them with a fake transport and a
 * fake DemoStore and records which one answered.
 */

const METHODS_FILE = "apps/web/src/lib/api/http/api-methods.ts";
const CONTRACT_FILE = "apps/web/src/lib/api/contract.ts";
const FIXTURES_FILE = "packages/shared/src/types/fixtures.ts";

/** One request a method sends: `VERB /path` with parameters as `:p`, and the wrapper that softens refusals. */
export interface MethodRoute {
  route: string;
  /** `seen` and `seenOrOff` read a 403 as an empty list, `orNone` a 403 or 404 as nothing (api-methods.ts). */
  softens: "seen" | "seenOrOff" | "orNone" | null;
}

/**
 * Methods whose path comes from a helper rather than a literal at the call, with the routes the
 * helper builds. Reviewed by hand against the helper named in each reason. `routes` are the API's
 * own (the route catalog); `betterAuth` names the paths a helper sends through `http.auth()` to
 * Better Auth's endpoints (`/api/auth`, ADR 0060), which sit outside the catalog, as the lockout
 * test's do (CROSS_CUTTING).
 */
export const RESOLVED_ELSEWHERE: Readonly<Record<string, { routes: string[]; betterAuth?: string[]; why: string }>> = {
  getSettings: {
    routes: ["GET /settings"],
    why: "readSettings(http, demo) reads GET /settings and merges it over demo.getSettings() (settingsFromAnswer): Settings → Meetings, and any section the answer leaves out for this reader, still show DemoStore's values (G5).",
  },
  markNotificationsRead: {
    routes: ["POST /notifications/read"],
    why: "markRead(http, ids) in outbox-answer.ts posts the ids in batches.",
  },
  listOutbox: {
    routes: ["GET /outbox"],
    why: "readOutbox(http, all) in outbox-answer.ts reads /outbox, or /outbox?all=true.",
  },
  retryOutbox: {
    routes: ["POST /outbox/:p/retry"],
    why: "outboxAction(http, id, 'retry') in outbox-answer.ts builds /outbox/${id}/${action}.",
  },
  cancelOutbox: {
    routes: ["POST /outbox/:p/cancel"],
    why: "outboxAction(http, id, 'cancel') in outbox-answer.ts builds /outbox/${id}/${action}.",
  },
  updateSettings: {
    routes: API_SETTINGS_SECTIONS.map((section) => `PUT /settings/${section}`),
    why: "/settings/${section} for each section in the shared API_SETTINGS_SECTIONS; any other section (Settings → Meetings) still saves to DemoStore through demo.updateSettings (G2).",
  },
  updateLocalization: {
    routes: API_LOCALIZATION_TABS.map((tab) => `PUT /settings/localization/${tab}`),
    why: "/settings/localization/${tab} for each tab in the shared API_LOCALIZATION_TABS (all five since Settings part 3a); any other tab would save to DemoStore.",
  },
  signInSecurity: {
    routes: ["GET /auth/context"],
    betterAuth: ["GET /passkey/list-user-passkeys"],
    why: "signInSecurityOn(http) in lib/session/passkeys.ts reads /auth/context and, through http.auth(), the passkey list.",
  },
  confirmPassword: {
    routes: [],
    betterAuth: ["POST /verify-password"],
    why: "confirmPasswordOn(http.auth(), password) in lib/session/passkeys.ts.",
  },
  addPasskey: {
    routes: [],
    betterAuth: ["GET /passkey/generate-register-options", "POST /passkey/verify-registration"],
    why: "addPasskeyOn(http.auth(), name) in lib/session/passkeys.ts.",
  },
  renamePasskey: {
    routes: [],
    betterAuth: ["POST /passkey/update-passkey"],
    why: "renamePasskeyOn(http.auth(), id, name) in lib/session/passkeys.ts.",
  },
  deletePasskey: {
    routes: [],
    betterAuth: ["POST /passkey/delete-passkey"],
    why: "deletePasskeyOn(http.auth(), id) in lib/session/passkeys.ts.",
  },
  approveSupportGrant: {
    routes: ["POST /support-grants/:p/approve"],
    why: "supportGrantDecision(http, grantId, 'approve') builds /support-grants/${id}/${step}.",
  },
  revokeSupportGrant: {
    routes: ["POST /support-grants/:p/revoke"],
    why: "supportGrantDecision(http, grantId, 'revoke') builds /support-grants/${id}/${step}.",
  },
  changePlatformCompanyStatus: {
    routes: [
      "POST /platform/companies/:p/suspend",
      "POST /platform/companies/:p/reinstate",
      "POST /platform/companies/:p/cancel",
    ],
    why: "/platform/companies/${companyId}/${input.action}: the action is suspend, reinstate or cancel (CompanyStatusInput).",
  },
  businessReport: {
    routes: ["GET /reports/business"],
    why: "businessReportPath(filters) in report-paths.ts returns /reports/business?<filters>.",
  },
  updatePlatformPlan: {
    routes: ["PATCH /platform/plans/:p"],
    why: "planCall(http, planId, 'PATCH', '', …) builds /platform/plans/${planId}.",
  },
  retirePlatformPlan: {
    routes: ["POST /platform/plans/:p/retire"],
    why: "planCall(http, planId, 'POST', '/retire', …) builds /platform/plans/${planId}/retire.",
  },
  restorePlatformPlan: {
    routes: ["POST /platform/plans/:p/restore"],
    why: "planCall(http, planId, 'POST', '/restore', …) builds /platform/plans/${planId}/restore.",
  },
};

/** The methods probed per collection instead of read as text: they route by SERVED_LISTS. */
export const PROBED_METHODS: readonly string[] = ["list", "get"];

/** The text of each top-level key of the API_METHODS object literal, by key, in file order. */
function methodTexts(): Map<string, string> {
  const code = withoutComments(readRepoFile(METHODS_FILE));
  const opening = /^export const API_METHODS(?:: HttpRoutes)? = \{$/m.exec(code);
  if (!opening) throw new Error(`API_METHODS' declaration not found in ${METHODS_FILE}: update methodTexts()`);
  const start = opening.index;
  const closing = /^\}(?: satisfies HttpRoutes)?;$/m.exec(code.slice(start));
  if (!closing) throw new Error(`API_METHODS' closing brace not found in ${METHODS_FILE}: update methodTexts()`);
  const body = code.slice(start, start + closing.index);
  const keys = [...body.matchAll(/^ {2}([A-Za-z_]\w*):/gm)];
  const texts = new Map<string, string>();
  keys.forEach((key, i) => {
    const from = key.index ?? 0;
    const to = keys[i + 1]?.index ?? body.length;
    texts.set(key[1] ?? "", body.slice(from, to));
  });
  return texts;
}

/** Every key of API_METHODS, read from the object itself. */
export function apiMethodKeys(): string[] {
  return Object.keys(API_METHODS).sort();
}

/** Every member of the ApiClient interface (contract.ts), read as text. */
export function apiClientMembers(): string[] {
  const code = withoutComments(readRepoFile(CONTRACT_FILE));
  const start = code.indexOf("export interface ApiClient {");
  const end = code.indexOf("\n}", start);
  const members = code.slice(start, end).matchAll(/^ {2}([A-Za-z_]\w*)\s*[(<?:]/gm);
  return [...new Set([...members].map((match) => match[1] ?? ""))].sort();
}

/** Every collection the client can `list` or `get`: CompanyFixtures' keys minus the three that aren't lists (contract.ts `Collections`). */
export function collectionNames(): CollectionName[] {
  const code = withoutComments(readRepoFile(FIXTURES_FILE));
  const start = code.indexOf("export interface CompanyFixtures {");
  const end = code.indexOf("\n}", start);
  const notLists = new Set(["companyId", "anchorDate", "settings"]);
  const keys = [...code.slice(start, end).matchAll(/^ {2}([A-Za-z_]\w*)\s*:/gm)].map((match) => match[1] ?? "");
  return keys.filter((key) => !notLists.has(key)).sort() as CollectionName[];
}

/**
 * The requests one method's text sends. `literal` is false when a call's path isn't a string or
 * template literal at the call (the method then needs a RESOLVED_ELSEWHERE entry).
 */
function requestsIn(text: string): { routes: MethodRoute[]; literal: boolean } {
  const routes: MethodRoute[] = [];
  let literal = true;
  const call = /\b(seen|seenOrOff|orNone)?\(?\s*http\s*\.\s*(request|requestAsRead|blob)\s*(?:<[\s\S]*?>)?\s*\(/g;
  for (const match of text.matchAll(call)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    const args = insideParens(text, open) ?? "";
    const verb = match[2] === "blob" ? "GET" : /^\s*"(GET|POST|PUT|PATCH|DELETE)"/.exec(args)?.[1];
    const path = /["'`](\/[^"'`]*)["'`]/.exec(args)?.[1];
    if (!verb || !path) {
      literal = false;
      continue;
    }
    const softens = (match[1] as MethodRoute["softens"] | undefined) ?? null;
    routes.push({ route: `${verb} ${normalPath(path)}`, softens });
  }
  return { routes, literal: literal && routes.length > 0 };
}

/**
 * The routes each API_METHODS key reaches, by key; `list` and `get` are left out (see
 * `servedCollections`). A key whose paths aren't all literal takes its routes from RESOLVED_ELSEWHERE,
 * and one missing there is in `unresolved`.
 */
export function methodRoutes(): { routes: Map<string, MethodRoute[]>; unresolved: string[] } {
  const routes = new Map<string, MethodRoute[]>();
  const unresolved: string[] = [];
  for (const [method, text] of methodTexts()) {
    if (PROBED_METHODS.includes(method)) continue;
    const found = requestsIn(text);
    const elsewhere = RESOLVED_ELSEWHERE[method];
    if (found.literal && !elsewhere) routes.set(method, found.routes);
    else if (elsewhere)
      routes.set(
        method,
        elsewhere.routes.map((route) => ({ route, softens: null })),
      );
    else unresolved.push(method);
  }
  return { routes, unresolved };
}

/** How `list` or `get` softens a refusal from the API (both read through `seen`), from their text. */
export function probedSoftens(method: string): MethodRoute["softens"] {
  const text = methodTexts().get(method) ?? "";
  const wrapper = /\b(seen|seenOrOff|orNone)\(\s*http\s*\.\s*request/.exec(text)?.[1];
  return (wrapper as MethodRoute["softens"] | undefined) ?? null;
}

/**
 * The keys RESOLVED_ELSEWHERE lists that no longer need it: gone from API_METHODS, or now sending
 * literal paths that the route catalog (`known`) has as they are.
 */
export function staleResolvedElsewhere(known: (route: string) => boolean): string[] {
  const texts = methodTexts();
  return Object.keys(RESOLVED_ELSEWHERE).filter((method) => {
    const text = texts.get(method);
    if (text === undefined) return true;
    const found = requestsIn(text);
    return found.literal && found.routes.every((r) => known(r.route));
  });
}

/**
 * The route a probe sent to the fake transport, or undefined when it read the fake DemoStore. The
 * fake answers `[]` to everything, so a method that reshapes a richer answer (the `users` list
 * reads `GET /company` and maps its people) throws after sending; the route it sent still counts.
 * A throw before any request is rethrown, so nothing is classed DemoStore by accident.
 */
async function probe(
  run: (http: HttpTransport, demo: ApiClient) => Promise<unknown> | undefined,
): Promise<string | undefined> {
  const sent: string[] = [];
  const http = {
    request: async (verb: string, path: string) => {
      sent.push(`${verb} ${normalPath(path)}`);
      return [];
    },
  } as unknown as HttpTransport;
  const demo = { list: async () => [], get: async () => undefined } as unknown as ApiClient;
  try {
    await run(http, demo);
  } catch (error) {
    if (sent.length === 0) throw error;
  }
  return sent[0];
}

/**
 * The collections `list` and `get` send to the API, with the route each calls, found by calling
 * the real factories with a recording transport and DemoStore. A collection missing from a map
 * stays on DemoStore in api mode.
 */
export async function servedCollections(): Promise<{ list: Map<string, string>; get: Map<string, string> }> {
  const list = new Map<string, string>();
  const get = new Map<string, string>();
  for (const collection of collectionNames()) {
    const listed = await probe((http, demo) => API_METHODS.list?.(http, demo)(collection));
    if (listed) list.set(collection, listed);
    const got = await probe((http, demo) => API_METHODS.get?.(http, demo)(collection, "id"));
    if (got) get.set(collection, got);
  }
  return { list, get };
}
