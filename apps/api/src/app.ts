import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import type { ApiEnv } from "./core/config/env";
import { ErrorFilter } from "./core/errors/error-filter";

/** Where the OpenAPI document is served: a browsable page and the raw JSON for client generators. */
export const OPENAPI_PATHS = { ui: "docs", json: "docs/openapi.json" };

/** Publishes the OpenAPI document built from the controllers' decorators. */
function setUpOpenApi(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle("Flooring Platform API")
    .setDescription("REST API behind Flooring Suite and HR Suite. Conventions: docs/api-contract.md.")
    .setVersion("0.1.0")
    .build();
  SwaggerModule.setup(OPENAPI_PATHS.ui, app, () => SwaggerModule.createDocument(app, config), {
    jsonDocumentUrl: OPENAPI_PATHS.json,
  });
}

/**
 * Builds the configured app without listening, so main.ts and the tests start it the same way:
 * CORS limited to our own web origins with cookies, one error format, and the OpenAPI document.
 */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(), { logger: ["error", "warn", "log"] });
  const config = app.get<ConfigService<ApiEnv, true>>(ConfigService);
  app.enableCors({ origin: config.get("CORS_ORIGINS", { infer: true }), credentials: true });
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  setUpOpenApi(app);
  return app;
}
