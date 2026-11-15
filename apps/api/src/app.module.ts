import { Module, type DynamicModule, type Type } from "@nestjs/common";
import { AuthModule } from "./core/auth/auth.module";
import { BrandingModule } from "./core/branding/branding.module";
import { ApiConfigModule } from "./core/config/config.module";
import { ControlDbModule } from "./core/database/control-db";
import { EmailModule } from "./core/email/email.module";
import { StorageModule } from "./core/storage/storage.module";
import { LedgerModule } from "./core/ledger/ledger.module";
import { ContractsModule } from "./modules/contracts/contracts.module";
import { FinanceModule } from "./modules/finance/finance.module";
import { HrModule } from "./modules/hr/hr.module";
import { HealthController } from "./core/health/health.controller";
import { JobsModule } from "./core/jobs/jobs.module";
import { NotificationsModule } from "./core/notifications/notifications.module";
import { AccessModule } from "./core/access/access.module";
import { RequestPipelineModule } from "./core/request-pipeline.module";
import { TenancyModule } from "./core/tenancy/tenancy.module";
import { InventoryModule } from "./modules/inventory/inventory.module";
import { MeetingsModule } from "./modules/meetings/meetings.module";
import { ReportsModule } from "./modules/reports/reports.module";
import { PlatformModule } from "./modules/platform/platform.module";
import { PurchasingModule } from "./modules/purchasing/purchasing.module";
import { SalesModule } from "./modules/sales/sales.module";
import { UsersModule } from "./modules/users/users.module";

/**
 * The API's root module. core/ holds what every request passes through (config, database,
 * email, health, sign-in, tenancy, permissions, audit and public branding). Business modules go in
 * src/modules/, one folder each, in the order of docs/real-build-plan.md.
 */
@Module({})
export class AppModule {
  /**
   * The module with its settings read now, from the current environment. `extraModules` lets the
   * integration tests mount test-only controllers, such as the isolation probe; the app passes none.
   */
  static forRoot(extraModules: readonly Type[] = []): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ApiConfigModule.forRoot(),
        ControlDbModule,
        EmailModule,
        StorageModule,
        LedgerModule,
        AuthModule,
        TenancyModule,
        AccessModule,
        RequestPipelineModule,
        JobsModule,
        NotificationsModule,
        BrandingModule,
        UsersModule,
        PlatformModule,
        InventoryModule,
        PurchasingModule,
        SalesModule,
        FinanceModule,
        ContractsModule,
        HrModule,
        MeetingsModule,
        ReportsModule,
        ...extraModules,
      ],
      controllers: [HealthController],
    };
  }
}
