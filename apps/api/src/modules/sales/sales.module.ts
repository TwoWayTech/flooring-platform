import { Module } from "@nestjs/common";
import { NotificationsModule } from "../../core/notifications/notifications.module";
import { SalesController } from "./sales.controller";
import { SalesService } from "./sales.service";

/** Sales, part 1: customers and quotes with the tax engine (ADR 0037). */
@Module({ imports: [NotificationsModule], controllers: [SalesController], providers: [SalesService] })
export class SalesModule {}
