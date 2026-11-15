import {
  createParamDecorator,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { featureOn, PLATFORM_DEFAULT_WRITE_ROLES, type FeatureKey, type PlatformAdminRole } from "@workspace/shared";
import type { Request } from "express";
import type { AuthSession } from "../../core/auth/session.service";
import { StepUpService } from "../../core/auth/step-up.service";
import { PlatformAdmins } from "./platform-admins";

/** Methods that only read; everything else is a write. */
const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

const WRITE_ROLES_KEY = "platform:write-roles";

const FEATURE_KEY = "platform:feature";

/** What each platform refusal tells the person (docs/specs/platform-admin.md, "The platform guard"). */
export const PLATFORM_REFUSALS = {
  not_admin: "Only platform admins can use this.",
  owner_only: "Only the platform owner role can change this.",
} as const;

/** The platform admin making a request, with what the platform audit log records about it. */
export interface PlatformActor {
  userId: string;
  name: string;
  email: string;
  role: PlatformAdminRole;
  /** The verified session, for step-up. */
  session: AuthSession;
  ip: string | null;
  userAgent: string | null;
}

/** The request after the guards have run. */
type PlatformRequest = Request & { authSession?: AuthSession; platformAdmin?: PlatformActor };

/**
 * Lets these roles make the route's write. Without it only `PLATFORM_DEFAULT_WRITE_ROLES` (the
 * `owner` role, packages/shared) may (spec "The platform guard", step 4); only
 * `POST /platform/support-grants` also allows `support`.
 */
export const PlatformWriteRoles = (...roles: PlatformAdminRole[]) => SetMetadata(WRITE_ROLES_KEY, roles);

/**
 * Puts the route, or every route of the class, behind its own feature switch on top of
 * `admin.access` (docs/specs/platform-admin.md, "The platform guard (part 2): a switch per route";
 * ADR 0056). While the switch is off the guard answers 404 before it reads the admin row, so neither
 * the role check nor the step-up reveals the route (CLAUDE.md rule 13). A handler's key wins over
 * its class's; a route with no key behaves as before.
 */
export const PlatformFeature = (key: FeatureKey) => SetMetadata(FEATURE_KEY, key);

/**
 * The only authorization layer of every /platform route (docs/specs/platform-admin.md, "The
 * platform guard"; ADR 0052). Platform routes are `@SessionOnly()`, so TenantGuard and
 * PermissionGuard let them through and this guard, set at class level, denies by default:
 * 1. no verified session: 401 (SessionGuard answers first; this is the backstop for a route that
 *    ever skips it);
 * 2. `admin.access` switched off, or the route's own `@PlatformFeature` switch: 404, hidden
 *    everywhere (CLAUDE.md rule 13). Both are read on every request, never once at load;
 * 3. not an active platform admin with role `owner` or `support`: 403 `forbidden`;
 * 4. a write: a role the route allows (`owner` unless `@PlatformWriteRoles` says more), then a
 *    step-up from the last 5 minutes (403 `step_up_required`). The console runs on a company host
 *    with no admin host yet, so a stolen session could otherwise write in an admin's name.
 * Guards run before pipes and the handler's body check, so a non-admin gets 403 whatever the body.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly admins: PlatformAdmins,
    private readonly stepUp: StepUpService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PlatformRequest>();
    const session = request.authSession;
    if (!session) throw new UnauthorizedException({ code: "unauthenticated", message: "Sign in to continue." });
    if (!this.switchedOn(context)) throw new NotFoundException();
    const role = await this.admins.roleOf(session.user.id);
    if (!role) throw new ForbiddenException({ code: "forbidden", message: PLATFORM_REFUSALS.not_admin });
    if (!READ_METHODS.has(request.method)) {
      const allowed =
        this.reflector.getAllAndOverride<readonly PlatformAdminRole[]>(WRITE_ROLES_KEY, [
          context.getHandler(),
          context.getClass(),
        ]) ?? PLATFORM_DEFAULT_WRITE_ROLES;
      if (!allowed.includes(role))
        throw new ForbiddenException({ code: "forbidden", message: PLATFORM_REFUSALS.owner_only });
      await this.stepUp.require(session);
    }
    request.platformAdmin = {
      userId: session.user.id,
      name: session.user.name,
      email: session.user.email,
      role,
      session,
      ip: request.ip ?? null,
      userAgent: request.get("user-agent") ?? null,
    };
    return true;
  }

  /** Whether `admin.access` and the route's own switch, if it names one, are on (step 2). */
  private switchedOn(context: ExecutionContext): boolean {
    if (!featureOn("admin.access")) return false;
    const key = this.reflector.getAllAndOverride<FeatureKey | undefined>(FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    return key === undefined || featureOn(key);
  }
}

/** The platform admin PlatformAdminGuard let through for this request. */
export const CurrentPlatformAdmin = createParamDecorator((_data: unknown, context: ExecutionContext): PlatformActor => {
  const admin = context.switchToHttp().getRequest<PlatformRequest>().platformAdmin;
  if (!admin) throw new Error("CurrentPlatformAdmin used on a route without PlatformAdminGuard.");
  return admin;
});
