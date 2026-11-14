import { Module } from "@nestjs/common";
import { AccountingController } from "./accounting.controller";
import { AccountingService } from "./accounting.service";
import { LedgerController } from "./ledger.controller";

/**
 * Finance: the ledger's reads, the period close (ADR 0039) and Settings → Accounting (ADR 0040);
 * expenses arrive in P12 part 2.
 */
@Module({ controllers: [LedgerController, AccountingController], providers: [AccountingService] })
export class FinanceModule {}
