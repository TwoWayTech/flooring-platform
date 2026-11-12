import { ConfigService } from "@nestjs/config";
import { createApp } from "./app";
import type { ApiEnv } from "./core/config/env";

/** Starts the API on API_PORT (4000 by default). */
async function bootstrap(): Promise<void> {
  const app = await createApp();
  const port = app.get<ConfigService<ApiEnv, true>>(ConfigService).get("API_PORT", { infer: true });
  await app.listen(port);
}

void bootstrap();
