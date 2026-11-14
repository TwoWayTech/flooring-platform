import { Module } from "@nestjs/common";
import { NotificationsModule } from "../../core/notifications/notifications.module";
import { PayablesController } from "./payables.controller";
import { PayablesService } from "./payables.service";
import { PurchasingController } from "./purchasing.controller";
import { PurchasingService } from "./purchasing.service";

/**
 * Purchasing: suppliers, contacts, purchase orders and goods receipts (part 1, ADR 0036), and
 * bills and supplier payments with their postings (P12 part 3, ADR 0042).
 */
@Module({
  imports: [NotificationsModule],
  controllers: [PurchasingController, PayablesController],
  providers: [PurchasingService, PayablesService],
})
export class PurchasingModule {}
