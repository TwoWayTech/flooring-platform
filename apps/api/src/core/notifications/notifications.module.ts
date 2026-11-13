import { Module } from "@nestjs/common";
import { NotificationsController, OutboxController } from "./notifications.controller";
import { NotificationService } from "./notification.service";

/** The notifications core: raising events, the Outbox worker, in-app notes and the auth cleanup job (ADR 0032). */
@Module({
  controllers: [NotificationsController, OutboxController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationsModule {}
