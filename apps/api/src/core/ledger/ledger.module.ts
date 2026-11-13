import { Global, Module } from "@nestjs/common";
import { LedgerService } from "./ledger.service";

/** The company ledger, available to every module that posts (ADR 0039). */
@Global()
@Module({ providers: [LedgerService], exports: [LedgerService] })
export class LedgerModule {}
