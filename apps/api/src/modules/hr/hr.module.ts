import { Module } from "@nestjs/common";
import { NotificationsModule } from "../../core/notifications/notifications.module";
import { PeopleController } from "./people.controller";
import { PeopleService } from "./people.service";
import { TimeOffController } from "./time-off.controller";
import { TimeOffService } from "./time-off.service";
import { TimesheetsController } from "./timesheets.controller";
import { TimesheetsService } from "./timesheets.service";

/**
 * HR, part 1 (hr.md; ADR 0046): people with their checklists and documents, timesheets with the
 * clock and overtime, and time off with its policies and ledger. One module for both products:
 * Flooring Suite companies with HR and HR Suite companies. Pay periods follow in part 2.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [PeopleController, TimesheetsController, TimeOffController],
  providers: [PeopleService, TimesheetsService, TimeOffService],
})
export class HrModule {}
