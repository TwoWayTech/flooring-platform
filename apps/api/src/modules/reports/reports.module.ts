import { Module } from "@nestjs/common";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

/**
 * Reports (module 15 of docs/real-build-plan.md; ADR 0055): the Business report, Profit and loss,
 * Sales by category and Payments received, read from the company's documents in one read-only
 * snapshot and worked out by the same shared calculation the demo runs.
 */
@Module({ controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
