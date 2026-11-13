import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PgBoss, type Job, type SendOptions } from "pg-boss";
import type { ApiEnv } from "../config/env";

/** The schema pg-boss keeps its tables in, inside the control database (ADR 0032). */
export const JOBS_SCHEMA = "pgboss";

/** How long to wait before trying to start pg-boss again while the database is unreachable. */
const START_RETRY_MS = 5_000;

/** A job's handler. It receives one job at a time; a thrown error makes pg-boss retry it. */
export type JobHandler<T extends object> = (job: Job<T>) => Promise<void>;

/**
 * Background jobs on pg-boss (blueprint "Stack": jobs; ADR 0032). One instance per API process,
 * on the control database in its own `pgboss` schema, through the standard `pg` driver (rule 11).
 *
 * pg-boss starts in the background and keeps retrying while the database is unreachable, so the
 * API always boots and /health can report the outage. Queueing and registering wait until it has
 * started. Workers run only when JOBS_ENABLED is true.
 */
@Injectable()
export class JobsService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger("Jobs");
  private readonly boss: PgBoss;
  private readonly workersEnabled: boolean;
  private readonly pollSeconds: number;
  private ready: Promise<void> = Promise.resolve();
  private started = false;
  private stopping = false;

  constructor(config: ConfigService<ApiEnv, true>) {
    this.boss = new PgBoss({
      connectionString: config.get("CONTROL_DATABASE_URL", { infer: true }),
      schema: JOBS_SCHEMA,
      application_name: "flooring-api-jobs",
    });
    // Job errors are logged without their data, which may name a company or a recipient.
    this.boss.on("error", (error: Error) => this.logger.error(`pg-boss: ${error.message}`));
    this.workersEnabled = config.get("JOBS_ENABLED", { infer: true });
    this.pollSeconds = config.get("JOBS_POLL_SECONDS", { infer: true });
  }

  onModuleInit(): void {
    this.ready = this.startWhenReachable();
  }

  /** Creates a queue and, when this instance runs workers, its worker. */
  async register<T extends object>(queue: string, handler: JobHandler<T>): Promise<void> {
    await this.ready;
    await this.boss.createQueue(queue, { retryLimit: 3, retryDelay: 30, retryBackoff: true });
    if (!this.workersEnabled) return;
    await this.boss.work<T>(queue, { pollingIntervalSeconds: this.pollSeconds }, async (jobs) => {
      for (const job of jobs) await handler(job);
    });
  }

  /** Queues a job. A `singletonKey` makes a second job with the same key a no-op while one waits. */
  async send(queue: string, data: object, options: SendOptions = {}): Promise<string | null> {
    await this.ready;
    return this.boss.send(queue, data, options);
  }

  /** Runs a queue on a cron schedule (UTC), replacing any earlier schedule of that queue. */
  async schedule(queue: string, cron: string): Promise<void> {
    await this.ready;
    await this.boss.schedule(queue, cron, {}, { tz: "UTC" });
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (!this.started) return;
    // Lets running jobs finish, so none is left half done; unfinished ones are retried later.
    await this.boss.stop({ graceful: true, timeout: 20_000 });
  }

  /** Starts pg-boss, retrying every few seconds until the database answers or the app stops. */
  private async startWhenReachable(): Promise<void> {
    while (!this.stopping) {
      try {
        await this.boss.start();
        this.started = true;
        return;
      } catch {
        this.logger.warn("pg-boss could not start; the control database is unreachable. Retrying.");
        await new Promise((resolve) => setTimeout(resolve, START_RETRY_MS).unref());
      }
    }
  }
}
