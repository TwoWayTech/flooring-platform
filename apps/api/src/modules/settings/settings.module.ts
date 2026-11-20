import { Module } from "@nestjs/common";
import { AuthModule } from "../../core/auth/auth.module";
import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";

/**
 * Settings on the API (module 4 of docs/real-build-plan.md), part 1 (ADR 0059): `GET /settings`
 * and the company profile, number format, payment rules and expense approval saves. AuthModule
 * gives StepUpService for saving Payments.
 */
@Module({ imports: [AuthModule], controllers: [SettingsController], providers: [SettingsService] })
export class SettingsModule {}
