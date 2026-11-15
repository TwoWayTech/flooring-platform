import { ForbiddenException, NotFoundException, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  FEATURES,
  PLATFORM_ADMIN_ROLES,
  PLATFORM_DEFAULT_WRITE_ROLES,
  type PlatformAdminRole,
} from "@workspace/shared";
import { describe, expect, it, vi } from "vitest";
import type { AuthSession } from "../src/core/auth/session.service";
import type { StepUpService } from "../src/core/auth/step-up.service";
import {
  PLATFORM_REFUSALS,
  PlatformAdminGuard,
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
});
