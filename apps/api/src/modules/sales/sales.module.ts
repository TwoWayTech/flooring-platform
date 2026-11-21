import { Module } from "@nestjs/common";
import { AuthModule } from "../../core/auth/auth.module";
import { NotificationsModule } from "../../core/notifications/notifications.module";
import { InvoicesController } from "./invoices.controller";
import { InvoicesService } from "./invoices.service";
import { PaymentsService } from "./payments.service";
import { SalesController } from "./sales.controller";
import { SalesService } from "./sales.service";

/** Sales: customers and quotes with the tax engine (ADR 0037); invoices, payments, credits and refunds (ADR 0038). */
@Module({
  // AuthModule gives StepUpService for refunds and write-offs (ADR 0063).
  imports: [AuthModule, NotificationsModule],
  controllers: [SalesController, InvoicesController],
  providers: [SalesService, InvoicesService, PaymentsService],
})
export class SalesModule {}
