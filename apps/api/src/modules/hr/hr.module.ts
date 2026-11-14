import { Module } from "@nestjs/common";
import { NotificationsModule } from "../../core/notifications/notifications.module";
import { BonusesService } from "./bonuses.service";
import { ContractorPaymentsService } from "./contractor-payments.service";
import { PayItemsController } from "./pay-items.controller";
import { PayPeriodsController } from "./pay-periods.controller";
import { PayPeriodsService } from "./pay-periods.service";
import { PeopleController } from "./people.controller";
import { PeopleService } from "./people.service";
import { TimeOffController } from "./time-off.controller";
import { TimeOffService } from "./time-off.service";
import { TimesheetsController } from "./timesheets.controller";
import { TimesheetsService } from "./timesheets.service";

/**
 * HR (hr.md; ADR 0046 and 0047): people with their checklists and documents, timesheets with the
 * clock and overtime, time off with its policies and ledger, and payroll: pay periods, bonuses and
 * contractor payments with their ledger postings. One module for both products: Flooring Suite
 * companies with HR and HR Suite companies.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [PeopleController, TimesheetsController, TimeOffController, PayPeriodsController, PayItemsController],
  providers: [
    PeopleService,
    TimesheetsService,
    TimeOffService,
    PayPeriodsService,
    BonusesService,
    ContractorPaymentsService,
  ],
})
export class HrModule {}
