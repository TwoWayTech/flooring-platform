import { Module } from "@nestjs/common";
import { AuthModule } from "../../core/auth/auth.module";
import { ImportsController } from "./imports.controller";
import { ImportsService } from "./imports.service";

/**
 * Data import, part 1 (module 16 of docs/real-build-plan.md; ADR 0057): customers, customer
 * addresses, suppliers and products, with a dry run, the import, the history, Undo and saved
 * column choices. AuthModule gives StepUpService for the import and Undo.
 */
@Module({ imports: [AuthModule], controllers: [ImportsController], providers: [ImportsService] })
export class ImportsModule {}
