import "reflect-metadata";
import type { INestApplication, Type } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { IncomingMessage, ServerResponse } from "node:http";
import { toNodeHandler } from "better-auth/node";
import { AppModule } from "./app.module";
import type { Auth } from "./core/auth/auth";
import { settleClientIp } from "./core/auth/client-ip";
import { AUTH } from "./core/auth/tokens";
import type { ApiEnv } from "./core/config/env";
import { ErrorFilter, type ErrorBody } from "./core/errors/error-filter";

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

/** Where Better Auth's endpoints live; the web app proxies the same path (ADR 0029). */
export const AUTH_BASE_PATH = "/api/auth";

/** The answer to an auth request that did not come through the web host's auth route. */
const PROXY_REQUIRED_BODY: ErrorBody = {
  code: "proxy_required",
  message: "Sign in through the app's own address.",
};

/**
 * Mounts Better Auth on /api/auth/* ahead of the JSON body parser, which would otherwise consume
 * the request body before Better Auth reads it, then turns body parsing on for every other route.
 * Each auth request first gets a client IP the API can trust.
 */
function mountAuth(app: NestExpressApplication, proxySecret: string | undefined): void {
  const auth = app.get<Auth>(AUTH);
  const handler = toNodeHandler(auth);
  app
    .getHttpAdapter()
    .getInstance()
    .all(`${AUTH_BASE_PATH}/*splat`, (request: IncomingMessage, response: ServerResponse) => {
      // The per-IP limits read only the client IP our web proxy vouches for (client-ip.ts). In
      // production, auth requests that did not come through it are refused.
      if (!settleClientIp(request, proxySecret)) {
        response.writeHead(403, { "content-type": "application/json" });
        response.end(JSON.stringify(PROXY_REQUIRED_BODY));
        return;
      }
      return handler(request, response);
    });
  // Proof files travel as base64 JSON (ADR 0038), so only those routes take bodies of up to three 5 MB
  // files; every other route keeps the parser's small default.
  app.useBodyParser("json", { limit: PROOF_BODY_LIMIT, type: (request) => isJson(request) && carriesProof(request) });
  app.useBodyParser("json", { type: (request) => isJson(request) && !carriesProof(request) });
  app.useBodyParser("urlencoded", { extended: true });
}

/** The largest proof-carrying body: three files of 5 MB in base64, with room for the form fields. */
const PROOF_BODY_LIMIT = "21mb";

/** POST /payments, /payments/:id/files, /refunds and /expenses carry proof files. */
const PROOF_ROUTES = /^\/(payments(\/[0-9a-fA-F-]{36}\/files)?|refunds|expenses)\/?$/;

/** PUT /expenses/:id finishes a draft with its receipts (ADR 0041). */
const PROOF_PUT_ROUTES = /^\/expenses\/[0-9a-fA-F-]{36}\/?$/;

function isJson(request: IncomingMessage): boolean {
  return (request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json");
}

/**
 * A proof upload: POST (or PUT for an expense draft) to a proof route with a session cookie. Requests without one keep the
 * small limit. The cookie is not verified before parsing, so per-IP limits on these routes are a
 * follow-up (docs/STATUS.md).
 */
function carriesProof(request: IncomingMessage): boolean {
  if (request.method !== "POST" && request.method !== "PUT") return false;
  if (!(request.headers.cookie ?? "").includes("better-auth.session_token=")) return false;
  const path = (request.url ?? "").split("?")[0] ?? "";
  return request.method === "POST" ? PROOF_ROUTES.test(path) : PROOF_PUT_ROUTES.test(path);
}

/**
 * Builds the configured app without listening, so main.ts and the tests start it the same way:
 * CORS limited to our own web origins with cookies, sign-in, one error format, and the OpenAPI document.
 * Tests may pass extra modules (AppModule.forRoot); main.ts passes none.
 */
export async function createApp(extraModules: readonly Type[] = []): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(extraModules), {
    logger: ["error", "warn", "log"],
    bodyParser: false,
  });
  const config = app.get<ConfigService<ApiEnv, true>>(ConfigService);
  app.enableCors({ origin: config.get("CORS_ORIGINS", { infer: true }), credentials: true });
  mountAuth(app, config.get("AUTH_PROXY_SECRET", { infer: true }));
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  setUpOpenApi(app);
  return app;
}
