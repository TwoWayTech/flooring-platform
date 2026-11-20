import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { featureOn, type FeatureKey } from "@workspace/shared";
import { z } from "zod";
import type { RequestAccess } from "../access/access.service";
import { AnyCompanyMember, RequirePermission } from "../access/permission.decorators";
import { CurrentAccess } from "../access/permission.guard";
import { CurrentSession } from "../auth/session.guard";
import type { AuthSession } from "../auth/session.service";
import { CurrentTenant, type TenantContext } from "../tenancy/tenant-context";
import { NotificationService } from "./notification.service";

/** The body of POST /notifications/read: optional note ids (Zod at the boundary). */
const MARK_READ = z.object({ ids: z.array(z.string().uuid()).max(200).optional() });

/** A switched-off feature is hidden from the API too (CLAUDE.md rule 13): its routes answer 404. */
function requireFeature(key: FeatureKey): void {
  if (!featureOn(key)) throw new NotFoundException();
}

/** The person's own in-app notifications, behind the bell (spec "InAppNotification read state"). */
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  /** GET /notifications: the person's own notes, newest first. */
  @Get()
  @AnyCompanyMember()
  list(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    requireFeature("shell.notifications");
    return this.notifications.listInApp(tenant, access.userId);
  }

  /** POST /notifications/read: marks the given notes read, or all unread ones; only the person's own. */
  @Post("read")
  @AnyCompanyMember()
  async markRead(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @Body() body: unknown,
  ) {
    requireFeature("shell.notifications");
    const parsed = MARK_READ.safeParse(body ?? {});
    if (!parsed.success)
      throw new BadRequestException({ code: "invalid_request", message: "ids must be a list of ids." });
    await this.notifications.markRead(tenant, access.userId, parsed.data.ids);
    return { ok: true };
  }
}

/** The Outbox: one row per email sent or held (spec "Outbox"). */
@Controller("outbox")
export class OutboxController {
  constructor(private readonly notifications: NotificationService) {}

  /**
   * GET /outbox: everyone sees the messages they caused or received; with `?all=true` (the whole
   * company's Outbox, Settings → Outbox) `settings.outbox.view` sees all, as the spec's
   * `admin = all && can("settings.outbox.view")`, so the personal `/outbox` page lists only one's
   * own rows whatever one holds (ADR 0059, bell and Outbox part, D2). Restricted messages of others
   * are redacted without `hr.employee.view`, a private meeting's for everyone it does not involve
   * (spec "Who can see"). Any other value of `all` is the personal view.
   */
  @Get()
  @AnyCompanyMember()
  list(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Query("all") all: unknown,
  ) {
    requireFeature("settings.outbox");
    return this.notifications.listOutbox(tenant, {
      userId: access.userId,
      email: session.user.email,
      admin: all === "true" && access.permissions.has("settings.outbox.view"),
      hrView: access.permissions.has("hr.employee.view"),
    });
  }

  /** POST /outbox/:id/retry: sends a failed message again (spec `retryOutbox`). */
  @Post(":id/retry")
  @RequirePermission("settings.outbox.view")
  async retry(@CurrentTenant() tenant: TenantContext, @Param("id", ParseUUIDPipe) id: string) {
    requireFeature("settings.outbox");
    await this.notifications.retry(tenant, id);
    return { ok: true };
  }

  /** POST /outbox/:id/cancel: cancels a scheduled message (spec `cancelOutbox`). */
  @Post(":id/cancel")
  @RequirePermission("settings.outbox.view")
  async cancel(@CurrentTenant() tenant: TenantContext, @Param("id", ParseUUIDPipe) id: string) {
    requireFeature("settings.outbox");
    await this.notifications.cancel(tenant, id);
    return { ok: true };
  }
}
