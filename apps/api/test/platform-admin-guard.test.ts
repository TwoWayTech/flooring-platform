import { ForbiddenException, NotFoundException, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  FEATURES,
  PLATFORM_ADMIN_ROLES,
  PLATFORM_DEFAULT_WRITE_ROLES,
  type FeatureKey,
  type PlatformAdminRole,
} from "@workspace/shared";
import { describe, expect, it, vi } from "vitest";
import type { AuthSession } from "../src/core/auth/session.service";
import type { StepUpService } from "../src/core/auth/step-up.service";
import {
  PLATFORM_REFUSALS,
  PlatformAdminGuard,
  PlatformFeature,
  PlatformWriteRoles,
  type PlatformActor,
} from "../src/modules/platform/platform-admin.guard";
import type { PlatformAdmins } from "../src/modules/platform/platform-admins";

const SESSION: AuthSession = {
  user: { id: "u1", name: "Pat Admin", email: "pat@example.test" },
  sessionId: "s1",
  sessionCreatedAt: new Date(),
  companyId: null,
  mfa: { required: true, totp: true, passkeys: 0, state: "ok" },
};

/** A controller with one route that names its write roles and one that does not. */
class Probe {
  read() {}
  write() {}
  @PlatformWriteRoles("owner", "support")
  ask() {}
}

/** A controller behind `admin.billing` at class level, as part 2's are, with one handler naming another switch. */
@PlatformFeature("admin.billing")
class BillingProbe {
  read() {}
  write() {}
  @PlatformFeature("admin.access")
  ownSwitch() {}
}

/** A controller with no switch of its own, and one handler behind `admin.billing`. */
class MixedProbe {
  plain() {}
  @PlatformFeature("admin.billing")
  switched() {}
}

/** A request as the guard reads it, after SessionGuard. */
function requestFor(method: string, session: AuthSession | null = SESSION) {
  return {
    method,
    authSession: session ?? undefined,
    ip: "203.0.113.7",
    get: (header: string) => (header === "user-agent" ? "guard-test" : undefined),
    platformAdmin: undefined as PlatformActor | undefined,
  };
}

function contextFor(request: ReturnType<typeof requestFor>, handler: keyof Probe): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => Probe.prototype[handler],
    getClass: () => Probe,
  } as unknown as ExecutionContext;
}

/** The context of a request to `handler` on any probe controller. */
function contextOn<T extends object>(
  request: ReturnType<typeof requestFor>,
  controller: { prototype: T },
  handler: keyof T,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => controller.prototype[handler],
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

/** Runs `run` with a feature switched off, as the integration tests flip one, and puts it back. */
async function withSwitchOff(key: FeatureKey, run: () => Promise<void>): Promise<void> {
  const feature = FEATURES[key] as { enabled: boolean };
  feature.enabled = false;
  try {
    await run();
  } finally {
    feature.enabled = true;
  }
}

/** The guard with an admin reader that answers `role` and a step-up that passes or refuses. */
function guardFor(role: PlatformAdminRole | null, stepUp: () => Promise<void> = async () => {}) {
  const admins = { roleOf: vi.fn(async () => role) };
  const steps = { require: vi.fn(stepUp) };
  const guard = new PlatformAdminGuard(
    new Reflector(),
    admins as unknown as PlatformAdmins,
    steps as unknown as StepUpService,
  );
  return { guard, admins, steps };
}

async function refusal(promise: Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try {
    await promise;
  } catch (error) {
    if (
      error instanceof UnauthorizedException ||
      error instanceof NotFoundException ||
      error instanceof ForbiddenException
    ) {
      return { status: error.getStatus(), body: error.getResponse() };
    }
    throw error;
  }
  throw new Error("The guard let the request through.");
}

describe("PlatformAdminGuard (docs/specs/platform-admin.md, the platform guard; deny by default)", () => {
  it("refuses a request with no verified session (401), before anything else", async () => {
    const { guard, admins } = guardFor("owner");
    expect((await refusal(guard.canActivate(contextFor(requestFor("GET", null), "read")))).status).toBe(401);
    expect(admins.roleOf).not.toHaveBeenCalled();
  });

  it("answers 404 while admin.access is switched off, without reading the admin row", async () => {
    const feature = FEATURES["admin.access"] as { enabled: boolean };
    feature.enabled = false;
    try {
      const { guard, admins } = guardFor("owner");
      expect((await refusal(guard.canActivate(contextFor(requestFor("GET"), "read")))).status).toBe(404);
      expect(admins.roleOf).not.toHaveBeenCalled();
    } finally {
      feature.enabled = true;
    }
  });

  it("refuses someone who is not an active platform admin with an accepted role (403)", async () => {
    const { guard } = guardFor(null);
    expect(await refusal(guard.canActivate(contextFor(requestFor("GET"), "read")))).toEqual({
      status: 403,
      body: { code: "forbidden", message: PLATFORM_REFUSALS.not_admin },
    });
  });

  it("lets either role read without a step-up, and records who and from where", async () => {
    for (const role of ["owner", "support"] as const) {
      const { guard, steps } = guardFor(role);
      const request = requestFor("GET");
      expect(await guard.canActivate(contextFor(request, "read"))).toBe(true);
      expect(steps.require).not.toHaveBeenCalled();
      expect(request.platformAdmin).toMatchObject({
        userId: "u1",
        role,
        ip: "203.0.113.7",
        userAgent: "guard-test",
      });
    }
  });

  it("lets only the shared default write roles (the owner role) write where the route names no roles, before any step-up", async () => {
    expect(PLATFORM_DEFAULT_WRITE_ROLES).toEqual(["owner"]);
    for (const role of PLATFORM_ADMIN_ROLES) {
      const { guard, steps } = guardFor(role);
      const context = contextFor(requestFor("PATCH"), "write");
      if (PLATFORM_DEFAULT_WRITE_ROLES.includes(role)) {
        expect(await guard.canActivate(context)).toBe(true);
        expect(steps.require).toHaveBeenCalledWith(SESSION);
      } else {
        expect(await refusal(guard.canActivate(context))).toEqual({
          status: 403,
          body: { code: "forbidden", message: PLATFORM_REFUSALS.owner_only },
        });
        expect(steps.require).not.toHaveBeenCalled();
      }
    }
  });

  it("needs a fresh step-up for every write, the support request included", async () => {
    const refused = new ForbiddenException({ code: "step_up_required", message: "Confirm it's you." });
    const { guard } = guardFor("support", async () => {
      throw refused;
    });
    const request = requestFor("POST");
    expect((await refusal(guard.canActivate(contextFor(request, "ask")))).body).toMatchObject({
      code: "step_up_required",
    });
    expect(request.platformAdmin).toBeUndefined();
    const passing = guardFor("support");
    expect(await passing.guard.canActivate(contextFor(requestFor("POST"), "ask"))).toBe(true);
    expect(passing.steps.require).toHaveBeenCalledTimes(1);
  });

  it("G-7: answers 404 on a route behind admin.billing while it is off, without reading the admin row or asking for a step-up", async () => {
    await withSwitchOff("admin.billing", async () => {
      for (const [method, handler] of [
        ["GET", "read"],
        ["POST", "write"],
      ] as const) {
        const { guard, admins, steps } = guardFor("owner");
        const request = requestFor(method);
        expect((await refusal(guard.canActivate(contextOn(request, BillingProbe, handler)))).status).toBe(404);
        expect(admins.roleOf).not.toHaveBeenCalled();
        expect(steps.require).not.toHaveBeenCalled();
        expect(request.platformAdmin).toBeUndefined();
      }
      // A non-admin learns only that a switch is off.
      const { guard } = guardFor(null);
      expect((await refusal(guard.canActivate(contextOn(requestFor("GET"), BillingProbe, "read")))).status).toBe(404);
    });
    // admin.access off hides it too, still before the admin row.
    await withSwitchOff("admin.access", async () => {
      const { guard, admins } = guardFor("owner");
      expect((await refusal(guard.canActivate(contextOn(requestFor("GET"), BillingProbe, "read")))).status).toBe(404);
      expect(admins.roleOf).not.toHaveBeenCalled();
    });
  });

  it("G-8: with admin.billing on, keeps the usual order: not an admin 403, the owner role for writes, then the step-up", async () => {
    const notAdmin = guardFor(null);
    expect(await refusal(notAdmin.guard.canActivate(contextOn(requestFor("GET"), BillingProbe, "read")))).toEqual({
      status: 403,
      body: { code: "forbidden", message: PLATFORM_REFUSALS.not_admin },
    });
    const support = guardFor("support");
    expect(await support.guard.canActivate(contextOn(requestFor("GET"), BillingProbe, "read"))).toBe(true);
    expect(await refusal(support.guard.canActivate(contextOn(requestFor("POST"), BillingProbe, "write")))).toEqual({
      status: 403,
      body: { code: "forbidden", message: PLATFORM_REFUSALS.owner_only },
    });
    expect(support.steps.require).not.toHaveBeenCalled();
    const refused = new ForbiddenException({ code: "step_up_required", message: "Confirm it's you." });
    const stale = guardFor("owner", async () => {
      throw refused;
    });
    expect(
      (await refusal(stale.guard.canActivate(contextOn(requestFor("PATCH"), BillingProbe, "write")))).body,
    ).toMatchObject({ code: "step_up_required" });
    const owner = guardFor("owner");
    const request = requestFor("POST");
    expect(await owner.guard.canActivate(contextOn(request, BillingProbe, "write"))).toBe(true);
    expect(owner.steps.require).toHaveBeenCalledWith(SESSION);
    expect(request.platformAdmin).toMatchObject({ userId: "u1", role: "owner" });
  });

  it("G-9: lets a handler's switch win over its class's, and a route with no switch ignore admin.billing", async () => {
    await withSwitchOff("admin.billing", async () => {
      const { guard } = guardFor("owner");
      // The class says admin.billing, the handler admin.access: the handler's key decides.
      expect(await guard.canActivate(contextOn(requestFor("GET"), BillingProbe, "ownSwitch"))).toBe(true);
      // No switch on the class: one handler is behind admin.billing, the other is not.
      expect(await guard.canActivate(contextOn(requestFor("GET"), MixedProbe, "plain"))).toBe(true);
      expect((await refusal(guard.canActivate(contextOn(requestFor("GET"), MixedProbe, "switched")))).status).toBe(404);
      // Part 1 and 3's controllers name no switch, so they answer as before.
      expect(await guard.canActivate(contextFor(requestFor("GET"), "read"))).toBe(true);
    });
    const { guard } = guardFor("owner");
    expect(await guard.canActivate(contextOn(requestFor("GET"), MixedProbe, "switched"))).toBe(true);
  });
});
