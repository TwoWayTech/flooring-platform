import { Module } from "@nestjs/common";
import { NotificationsModule } from "../../core/notifications/notifications.module";
import { MeetingMoves } from "./meeting-moves.service";
import { MeetingReminders } from "./meeting-reminders";
import { MeetingSends } from "./meeting-sends";
import { MeetingWrites } from "./meeting-writes";
import { MeetingsController } from "./meetings.controller";
import { MeetingsService } from "./meetings.service";

/**
 * Meetings (meetings.md; ADR 0051), in both products: the calendar, guests and invites with their
 * calendar files, answers, requests and reminders (part 1), moves, undo and proposal decisions
 * (part 2), through the notifications core. The screens move to the API in part 3.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [MeetingsController],
  providers: [MeetingsService, MeetingMoves, MeetingSends, MeetingReminders, MeetingWrites],
})
export class MeetingsModule {}
