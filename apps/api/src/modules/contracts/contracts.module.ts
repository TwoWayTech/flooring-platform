import { Module } from "@nestjs/common";
import { NotificationsModule } from "../../core/notifications/notifications.module";
import { ContractBillingService } from "./contract-billing.service";
import { ContractChangesService } from "./contract-changes.service";
import { ContractsController } from "./contracts.controller";
import { ContractsService } from "./contracts.service";

/**
 * Contracts: the register with its schedule of values, change orders, lien waivers and
 * certificates of insurance (ADR 0044), and progress billings, retainage releases and their voids
 * with their invoices, bills and postings (ADR 0045).
 */
@Module({
  imports: [NotificationsModule],
  controllers: [ContractsController],
  providers: [ContractsService, ContractChangesService, ContractBillingService],
})
export class ContractsModule {}
