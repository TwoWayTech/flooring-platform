import { Module } from "@nestjs/common";
import { LedgerController } from "./ledger.controller";

/** Finance: the ledger's reads and the period close (ADR 0039); expenses arrive in P12 part 2. */
@Module({ controllers: [LedgerController] })
export class FinanceModule {}
