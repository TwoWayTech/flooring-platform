import { Module } from "@nestjs/common";
import { AuthModule } from "../../core/auth/auth.module";
import { NotificationsModule } from "../../core/notifications/notifications.module";
import { BonusesService } from "./bonuses.service";
import { CommissionsController, CommissionTotalsController } from "./commissions.controller";
import { CommissionsService } from "./commissions.service";
import { ContractorPaymentsService } from "./contractor-payments.service";
import { PayItemsController } from "./pay-items.controller";
import { PayPeriodsController } from "./pay-periods.controller";
import { PayPeriodsService } from "./pay-periods.service";
import { PeopleController } from "./people.controller";
import { PeopleService } from "./people.service";
import { PortalController } from "./portal.controller";
import { PortalService } from "./portal.service";
import { TimeOffController } from "./time-off.controller";
import { TimeOffService } from "./time-off.service";
import { TimesheetsController } from "./timesheets.controller";
import { TimesheetsService } from "./timesheets.service";

/**
 * HR (hr.md; ADR 0046 and 0047): people with their checklists and documents, timesheets with the
 * clock and overtime, time off with its policies and ledger, and payroll: pay periods, bonuses and
 * contractor payments with their ledger postings, and commissions (ADR 0048), paid through pay runs; and the employee portal (ADR 0049). One module for both products: Flooring Suite
 * companies with HR and HR Suite companies.
 */
@Module({
  // AuthModule gives StepUpService for approving and reopening a pay period (ADR 0063).
  imports: [AuthModule, NotificationsModule],
  controllers: [
    PeopleController,
    TimesheetsController,
    TimeOffController,
    PayPeriodsController,
    PayItemsController,
    CommissionsController,
    CommissionTotalsController,
    PortalController,
  ],
  providers: [
    PeopleService,
    TimesheetsService,
    TimeOffService,
    PayPeriodsService,
    BonusesService,
    ContractorPaymentsService,
    CommissionsService,
    PortalService,
  ],
})
export class HrModule {}
