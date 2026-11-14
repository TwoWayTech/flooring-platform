import { Module } from "@nestjs/common";
import { NotificationsModule } from "../../core/notifications/notifications.module";
import { ContractChangesService } from "./contract-changes.service";
import { ContractsController } from "./contracts.controller";
import { ContractsService } from "./contracts.service";

/**
 * Contracts, part 1 (ADR 0044): the register with its schedule of values, change orders, lien
 * waivers and certificates of insurance. Progress billings and retainage releases are part 2.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [ContractsController],
  providers: [ContractsService, ContractChangesService],
})
export class ContractsModule {}
