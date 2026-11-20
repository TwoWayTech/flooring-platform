import { Module } from "@nestjs/common";
import { AuthModule } from "../../core/auth/auth.module";
import { AccountingController } from "./accounting.controller";
import { AccountingService } from "./accounting.service";
import { ExpensesController } from "./expenses.controller";
import { ExpensesService } from "./expenses.service";
import { LedgerController } from "./ledger.controller";
import { RecurringExpensesJob } from "./recurring-expenses.job";

/**
 * Finance: the ledger's reads, the period close (ADR 0039), Settings → Accounting (ADR 0040) and
 * expenses with their recurring drafts (ADR 0041). AuthModule gives StepUpService for saving accounting.
 */
@Module({
  imports: [AuthModule],
  controllers: [LedgerController, AccountingController, ExpensesController],
  providers: [AccountingService, ExpensesService, RecurringExpensesJob],
})
export class FinanceModule {}
