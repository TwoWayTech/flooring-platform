import { Controller, Get, HttpStatus, Inject, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiOkResponse, ApiProperty, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import type { ControlDb, DbHandle } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { Response } from "express";
import type { ApiEnv } from "../config/env";
import { CONTROL_DB } from "../database/control-db";

/** The health report: the API is up, and whether it can reach the control database. */
export class HealthReport {
  @ApiProperty({ enum: ["ok", "degraded"] })
  status: "ok" | "degraded";

  @ApiProperty({ example: "dev" })
  version: string;

  @ApiProperty({ enum: ["up", "down"] })
  database: "up" | "down";
}

/**
 * GET /health, for the host's health check and the uptime monitor (blueprint "Security":
 * monitoring). Public on purpose, so it reports nothing beyond up or down.
 */
@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly config: ConfigService<ApiEnv, true>,
  ) {}

  /** 200 when the control database answers, 503 when it does not. */
  @Get()
  @ApiOkResponse({ type: HealthReport })
  @ApiServiceUnavailableResponse({ type: HealthReport })
  async check(@Res({ passthrough: true }) response: Response): Promise<HealthReport> {
    const database = await this.ping();
    if (database === "down") response.status(HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: database === "up" ? "ok" : "degraded",
      version: this.config.get("APP_VERSION", { infer: true }),
      database,
    };
  }

  private async ping(): Promise<"up" | "down"> {
    try {
      await this.control.db.execute(sql`select 1`);
      return "up";
    } catch {
      return "down";
    }
  }
}
