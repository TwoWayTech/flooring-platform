import { Module } from "@nestjs/common";
import { NotificationsModule } from "../../core/notifications/notifications.module";
import { MeetingReminders } from "./meeting-reminders";
import { MeetingSends } from "./meeting-sends";
import { MeetingsController } from "./meetings.controller";
import { MeetingsService } from "./meetings.service";

/**
 * Meetings (meetings.md; ADR 0051), in both products: the calendar, guests and invites with their
 * calendar files, answers, requests and reminders, through the notifications core. Part 1 of 3:
 * moves, undo and proposal decisions come in part 2, the screens in part 3.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [MeetingsController],
  providers: [MeetingsService, MeetingSends, MeetingReminders],
})
export class MeetingsModule {}
