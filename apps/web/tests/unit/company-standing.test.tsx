import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FEATURES,
  PERMISSIONS,
  STANDING_SCREENS,
  SUPPORT_CLOSED_MESSAGES,
  SUPPORT_READ_ONLY_MESSAGE,
  SUBSCRIPTION_STANDING_TEXT,
  type Access,
  type CompanyBilling,
  type CompanyStandingState,
  type CompanySupportGrant,
  type OwnerBillingNotice,
  type PermissionKey,
  type ReadOnlyReason,
  type SubscriptionStanding,
} from "@workspace/shared";
import { BillingView } from "@/features/settings/billing/billing-page";
import { SupportAccessView } from "@/features/settings/users/support-access-panel";
import { BillingNotice } from "@/features/standing/billing-notice";
import { UnavailablePanel } from "@/features/standing/company-unavailable";
import { bannerReread, createRecheck, overlayState } from "@/features/standing/standing-rules";
import type { ApiClient } from "@/lib/api/contract";
import { ApiError } from "@/lib/api/errors";
import { API_METHODS } from "@/lib/api/http/api-methods";
import { routeClient } from "@/lib/api/http/router";
import { HttpApiError, HttpTransport } from "@/lib/api/http/transport";
import { onStandingSignal, withStandingWatch } from "@/lib/api/standing-watch";
import { serverStandingOf } from "@/lib/session/server-standing";
import { FLOORING } from "@/products/flooring";
import { HR } from "@/products/hr";
import { itemAllows, visibleItems } from "@/products";
import { canOpenPage } from "@/products/pages";

// The settings table keeps its view in the address; outside Next.js the router hooks have no app.
vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/users",
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

const GRANT_ID = "0195f3a2-7b1c-7d4e-8f00-1234567890ab";
const STANDING_CODES = ["company_maintenance", "company_unavailable", "company_suspended", "company_read_only"];
const ALL_STATES: CompanyStandingState[] = ["full", "read_only", "maintenance", "unavailable", "locked"];
const BLOCKING = ["maintenance", "unavailable", "locked"] as const;

/** Lets every pending promise callback run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** An ApiClient whose async methods all fail with `failure`, and whose `subscribe` returns `unsubscribe`. */
function failingClient(failure: Error, unsubscribe: () => void): ApiClient {
  const fail = () => Promise.reject(failure);
  return {
    list: fail,
    getCompanyStanding: fail,
    getCompanyBilling: fail,
    subscribe: () => unsubscribe,
  } as unknown as ApiClient;
}

/** Records every standing signal until the test ends. */
function listenForSignals(): string[] {
  const heard: string[] = [];
  const stop = onStandingSignal((code) => heard.push(code));
  stopListening.push(stop);
  return heard;
}
const stopListening: (() => void)[] = [];

afterEach(() => {
  stopListening.splice(0).forEach((stop) => stop());
});

interface Sent {
  url: string;
  method: string;
}

/** A client whose part 4 methods go over a fake fetch that records each request. */
function httpClient(answer: unknown) {
  const sent: Sent[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    sent.push({ url, method });
    return method === "POST" ? new Response(null, { status: 204 }) : new Response(JSON.stringify(answer));
  }) as unknown as typeof fetch;
  const client = routeClient({} as ApiClient, new HttpTransport("http://api.test", fetcher), API_METHODS);
  return { client, sent };
}

/** An access with every permission key, as the Owner or as someone else. */
function accessOf(isOwner: boolean, permissions: readonly PermissionKey[] = PERMISSIONS.map((p) => p.key)): Access {
  return { permissions: new Set(permissions), dataScope: "all", isOwner };
}

const billing = (overrides: Partial<CompanyBilling> = {}): CompanyBilling => ({
  status: "active",
  phase: "full",
  subscriptions: [
    {
      planName: "Flooring Pro",
      product: "flooring",
      interval: "monthly",
      currentPeriodStart: "2026-11-01T12:00:00.000Z",
      currentPeriodEnd: "2026-12-01T12:00:00.000Z",
      standing: "current",
    },
  ],
  limits: { userLimit: 16, branchLimit: 3 },
  notice: null,
  ...overrides,
});

const grant = (status: CompanySupportGrant["status"]): CompanySupportGrant => ({
  id: `grant-${status}`,
  adminName: `Admin ${status}`,
  reason: "Checking the roles the Owner asked about",
  requestedAt: "2026-11-15T09:00:00.000Z",
  expiresAt: "2026-11-15T11:00:00.000Z",
  status,
});

describe("the standing watch", () => {
  it.each(STANDING_CODES)("signals %s once and rethrows the same error", async (code) => {
    const heard = listenForSignals();
    const failure = new HttpApiError("Refused.", code === "company_suspended" ? 403 : 503, code);
    const client = withStandingWatch(failingClient(failure, () => undefined));
    await expect(client.list("audit")).rejects.toBe(failure);
    expect(heard).toEqual([code]);
  });

  it("never signals another refusal, a server error or a demo error", async () => {
    const heard = listenForSignals();
    for (const failure of [
      new HttpApiError("Your role does not allow this.", 403, "forbidden"),
      new HttpApiError("Request failed (500).", 500, "error"),
      new ApiError("company_maintenance"),
    ]) {
      await expect(withStandingWatch(failingClient(failure, () => undefined)).list("audit")).rejects.toBe(failure);
    }
    expect(heard).toEqual([]);
  });

  it("never watches the standing and billing reads", async () => {
    const heard = listenForSignals();
    const failure = new HttpApiError("Under maintenance.", 503, "company_maintenance");
    const client = withStandingWatch(failingClient(failure, () => undefined));
    await expect(client.getCompanyStanding()).rejects.toBe(failure);
    await expect(client.getCompanyBilling()).rejects.toBe(failure);
    expect(heard).toEqual([]);
  });

  it("returns synchronous results untouched", () => {
    const unsubscribe = () => undefined;
    const client = withStandingWatch(failingClient(new Error("unused"), unsubscribe));
    expect(client.subscribe(() => undefined)).toBe(unsubscribe);
  });
});

describe("standing rules", () => {
  it("shows the overlay only for the three blocking states", () => {
    expect(overlayState(null)).toBeNull();
    expect(overlayState({ state: "full" })).toBeNull();
    expect(overlayState({ state: "read_only" })).toBeNull();
    for (const state of BLOCKING) expect(overlayState({ state })).toBe(state);
  });

  it("re-reads the banner only on a move into full use or read only from another known state", () => {
    const yes: [CompanyStandingState, CompanyStandingState][] = [
      ["full", "read_only"],
      ["read_only", "full"],
      ["maintenance", "full"],
      ["locked", "read_only"],
    ];
    for (const [prev, next] of yes) expect(bannerReread(prev, next)).toBe(true);
    const no: [CompanyStandingState | null, CompanyStandingState | null][] = [
      [null, "full"],
      ["full", "full"],
      ["full", "maintenance"],
      ["read_only", "locked"],
      ...ALL_STATES.map((state): [CompanyStandingState, null] => [state, null]),
    ];
    for (const [prev, next] of no) expect(bannerReread(prev, next)).toBe(false);
  });

  it("keeps one read in flight and one trailing, in order, and resolves after the drain", async () => {
    const pending: ((value: string) => void)[] = [];
    const applied: string[] = [];
    const recheck = createRecheck(
      () => new Promise<string>((resolve) => pending.push(resolve)),
      (value) => applied.push(value),
    );
    let drained = false;
    void recheck().then(() => {
      drained = true;
    });
    void recheck();
    void recheck();
    const last = recheck();
    expect(pending).toHaveLength(1);
    pending[0]!("first");
    await settle();
    expect(pending).toHaveLength(2);
    expect(drained).toBe(false);
    pending[1]!("second");
    await last;
    await settle();
    expect(drained).toBe(true);
    expect(pending).toHaveLength(2);
    expect(applied).toEqual(["first", "second"]);
  });

  it("keeps what was known when a read fails", async () => {
    const applied: string[] = [];
    let fail = true;
    const recheck = createRecheck(
      () => (fail ? Promise.reject(new Error("offline")) : Promise.resolve("full")),
      (value) => applied.push(value),
    );
    await recheck();
    expect(applied).toEqual([]);
    fail = false;
    await recheck();
    expect(applied).toEqual(["full"]);
  });

  it("reads the server's standing from a 200 only, an unknown state as unavailable", () => {
    for (const state of ALL_STATES) expect(serverStandingOf(200, { state })).toEqual({ state });
    expect(serverStandingOf(200, { state: "weird" })).toEqual({ state: "unavailable" });
    expect(serverStandingOf(200, null)).toEqual({ state: "unavailable" });
    for (const status of [401, 403, 404, 500, 503]) expect(serverStandingOf(status, { state: "full" })).toBeNull();
  });
});

describe("standing and billing screens", () => {
  it.each(BLOCKING)("shows the %s screen's words, Try again and Sign out", (state) => {
    const html = renderToStaticMarkup(
      <UnavailablePanel
        state={state}
        titleAs="h1"
        pending={false}
        onRetry={() => undefined}
        onSignOut={() => undefined}
      />,
    );
    expect(html).toContain(`>${STANDING_SCREENS[state].title}</h1>`);
    expect(html).toContain(STANDING_SCREENS[state].body.replace(/'/g, "&#x27;"));
    expect(html).toContain("Try again");
    expect(html).toContain("Sign out");
  });

  const notices: OwnerBillingNotice[] = [
    { kind: "payment_overdue", since: "2026-11-12T12:00:00.000Z", readOnlyFrom: "2026-11-26T12:00:00.000Z" },
    ...(["suspended", "cancelled", "payment_lapsed", "trial_ended", "database", "account"] as ReadOnlyReason[]).map(
      (reason): OwnerBillingNotice => ({
        kind: "read_only",
        reason,
        since: null,
        lockedFrom: "2026-12-20T12:00:00.000Z",
      }),
    ),
  ];

  it.each(notices)("shows the $kind notice, linking to Billing except for a read-only database", (notice) => {
    const shown = renderToStaticMarkup(<BillingNotice notice={notice} showLink />);
    expect(shown).toContain('role="status"');
    expect(shown).toContain('aria-label="Account notice"');
    const database = notice.kind === "read_only" && notice.reason === "database";
    expect(shown.includes('href="/settings/billing"')).toBe(!database);
    expect(renderToStaticMarkup(<BillingNotice notice={notice} showLink={false} />)).not.toContain(
      'href="/settings/billing"',
    );
  });

  it("shows the plan, its period, its standing and the limits, and no money", () => {
    const html = renderToStaticMarkup(<BillingView billing={billing()} />);
    for (const text of [
      "Flooring Pro",
      "Flooring Suite",
      "Billed monthly",
      "Current period: ",
      "Current period ends ",
      ">16<",
      ">3<",
      "Stored, not enforced yet.",
      'href="/settings/users"',
      "See seats in use",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain("$");
    expect(html).not.toContain('aria-label="Account notice"');
  });

  it("leaves out See seats in use while Settings → Users is switched off (rule 13)", () => {
    const feature = FEATURES["settings.users"] as { enabled: boolean };
    feature.enabled = false;
    try {
      const html = renderToStaticMarkup(<BillingView billing={billing()} />);
      expect(html).not.toContain('href="/settings/users"');
      expect(html).not.toContain("See seats in use");
    } finally {
      feature.enabled = true;
    }
  });

  it.each(Object.keys(SUBSCRIPTION_STANDING_TEXT) as SubscriptionStanding[])(
    "shows the %s standing's words",
    (standing) => {
      const subscription = { ...billing().subscriptions[0]!, standing };
      const html = renderToStaticMarkup(<BillingView billing={billing({ subscriptions: [subscription] })} />);
      const words = SUBSCRIPTION_STANDING_TEXT[standing]("END").replace(" END", "");
      expect(html).toContain(words);
    },
  );

  it("shows No limit, the notice without its link, and a trial with no plan", () => {
    const html = renderToStaticMarkup(
      <BillingView
        billing={billing({
          status: "trial",
          subscriptions: [],
          limits: { userLimit: null, branchLimit: null },
          notice: { kind: "payment_overdue", since: null, readOnlyFrom: null },
        })}
      />,
    );
    expect(html.match(/No limit/g)).toHaveLength(2);
    expect(html).not.toContain("Stored, not enforced yet.");
    expect(html).toContain("No plan yet. Your trial includes every module of your products.");
    expect(html).toContain('aria-label="Account notice"');
    expect(html).not.toContain('href="/settings/billing"');
    expect(renderToStaticMarkup(<BillingView billing={billing({ subscriptions: [] })} />)).toContain("No plan.");
  });

  it("offers approve and revoke on a pending request and revoke on an approved one", () => {
    const html = renderToStaticMarkup(
      <SupportAccessView
        grants={[grant("pending"), grant("approved"), grant("revoked"), grant("expired")]}
        readOnly={false}
        onApprove={() => undefined}
        onRevoke={() => undefined}
      />,
    );
    expect(html).toContain("Support access");
    expect(html).toContain('aria-label="Approve support access for Admin pending"');
    expect(html).toContain('aria-label="Revoke support access for Admin pending"');
    expect(html).toContain('aria-label="Revoke support access for Admin approved"');
    expect(html).not.toContain("Approve support access for Admin approved");
    expect(html).not.toContain("support access for Admin revoked");
    expect(html).not.toContain("support access for Admin expired");
    expect(html).not.toContain(SUPPORT_READ_ONLY_MESSAGE.replace(/'/g, "&#x27;"));
  });

  it("offers no decision while the company is read only, and says why", () => {
    const html = renderToStaticMarkup(
      <SupportAccessView
        grants={[grant("pending"), grant("approved")]}
        readOnly
        onApprove={() => undefined}
        onRevoke={() => undefined}
      />,
    );
    expect(html).not.toContain("Approve support access");
    expect(html).not.toContain("Revoke support access");
    expect(html).toContain('role="note"');
    expect(html).toContain(SUPPORT_READ_ONLY_MESSAGE.replace(/'/g, "&#x27;"));
  });
});

describe("part 4 over HTTP", () => {
  it("reads standing from GET /company/standing, an unknown state as unavailable", async () => {
    const { client, sent } = httpClient({ state: "weird", reason: "move" });
    expect(await client.getCompanyStanding()).toEqual({ state: "unavailable" });
    expect(sent).toEqual([{ url: "http://api.test/company/standing", method: "GET" }]);
  });

  it("reads billing and the support list from the session's company", async () => {
    const { client, sent } = httpClient([]);
    await client.getCompanyBilling();
    await client.listSupportGrants();
    expect(sent).toEqual([
      { url: "http://api.test/billing", method: "GET" },
      { url: "http://api.test/support-grants", method: "GET" },
    ]);
  });

  it("sends the Owner's decisions by grant id", async () => {
    const { client, sent } = httpClient(null);
    await client.approveSupportGrant(GRANT_ID);
    await client.revokeSupportGrant(GRANT_ID);
    expect(sent).toEqual([
      { url: `http://api.test/support-grants/${GRANT_ID}/approve`, method: "POST" },
      { url: `http://api.test/support-grants/${GRANT_ID}/revoke`, method: "POST" },
    ]);
  });

  it("never sends a grant id that is not a UUID, and refuses with the closed-grant words", async () => {
    const { client, sent } = httpClient(null);
    await expect(client.approveSupportGrant("summit-sup-1")).rejects.toThrow(SUPPORT_CLOSED_MESSAGES.approve);
    await expect(client.revokeSupportGrant("summit-sup-1")).rejects.toThrow(SUPPORT_CLOSED_MESSAGES.revoke);
    await expect(client.revokeSupportGrant("summit-sup-1")).rejects.toBeInstanceOf(ApiError);
    expect(sent).toEqual([]);
  });
});

describe("Billing in the menus and the page gate", () => {
  const owner = accessOf(true);
  const manager = accessOf(false);
  const billingLink = (access: Access) =>
    visibleItems(FLOORING.settings, access).some((item) => item.href === "/settings/billing");

  it("lists Billing for the Owner only, and not while its switch is off", () => {
    expect(billingLink(owner)).toBe(true);
    expect(billingLink(manager)).toBe(false);
    const feature = FEATURES["settings.billing"] as { enabled: boolean };
    feature.enabled = false;
    try {
      expect(billingLink(owner)).toBe(false);
    } finally {
      feature.enabled = true;
    }
  });

  it("opens /settings/billing for the Owner only, on both hosts", () => {
    for (const product of ["flooring", "hr"] as const) {
      expect(canOpenPage(product, "/settings/billing", owner)).toBe(true);
      expect(canOpenPage(product, "/settings/billing", manager)).toBe(false);
      expect(canOpenPage(product, "/settings/billing", accessOf(true, []))).toBe(true);
    }
  });

  it("leaves every other settings page to its permissions, as before", () => {
    const some = accessOf(false, ["settings.users.view", "settings.audit.view"]);
    for (const config of [FLOORING, HR]) {
      for (const item of config.settings.filter((each) => !each.ownerOnly)) {
        for (const access of [owner, manager, some]) {
          const before = item.anyOf.some((key) => access.permissions.has(key));
          expect(canOpenPage(config.key, item.href, access)).toBe(before);
        }
      }
    }
  });

  it("leaves a page without a rule open to everyone, such as / and /outbox", () => {
    const nobody = accessOf(false, []);
    for (const product of ["flooring", "hr"] as const) {
      expect(canOpenPage(product, "/", nobody)).toBe(true);
      expect(canOpenPage(product, "/outbox", nobody)).toBe(true);
      expect(canOpenPage(product, "/settings/outbox", nobody)).toBe(false);
    }
  });

  it("lets an Owner-only item ignore its permissions", () => {
    const item = { anyOf: ["settings.users.view"] as PermissionKey[], ownerOnly: true };
    expect(itemAllows(item, accessOf(false))).toBe(false);
    expect(itemAllows(item, accessOf(true, []))).toBe(true);
    expect(itemAllows({ anyOf: item.anyOf }, accessOf(false))).toBe(true);
  });
});
