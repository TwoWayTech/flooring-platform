import { Module, type DynamicModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { validateEnv } from "./env";

/**
 * Loads and checks the environment once for the whole app. Inject `ConfigService<ApiEnv, true>`
 * to read a setting; nothing else reads process.env. forRoot reads the environment when the app
 * is created, not when this file is imported, so tests can set it first.
 */
@Module({})
export class ApiConfigModule {
  static forRoot(): DynamicModule {
    return {
      module: ApiConfigModule,
      global: true,
      imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, ignoreEnvFile: true, cache: true })],
    };
  }
}
