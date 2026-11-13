import { Module } from "@nestjs/common";
import { NotificationsModule } from "../../core/notifications/notifications.module";
import { PurchasingController } from "./purchasing.controller";
import { PurchasingService } from "./purchasing.service";

/** Purchasing, part 1: suppliers, contacts, purchase orders and goods receipts (ADR 0036). */
@Module({ imports: [NotificationsModule], controllers: [PurchasingController], providers: [PurchasingService] })
export class PurchasingModule {}
