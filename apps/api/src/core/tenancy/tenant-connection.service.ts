import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { decryptSecret, openCompanyDb, type CompanyDb, type ControlDb, type DbHandle } from "@workspace/db";
import { tenantDatabases } from "@workspace/db/control";
import { eq } from "drizzle-orm";
import type { ApiEnv } from "../config/env";
import { CONTROL_DB } from "../database/control-db";
import { companyUnavailable } from "./company-unavailable";
import { LruCache } from "./lru-cache";
import { TenantContext } from "./tenant-context";
import { isDatabaseUsable } from "./tenant-directory";

/** Connections per company pool; small, because many companies share one API instance. */
const POOL_SIZE = 3;

/** Seconds an unused connection stays open, so quiet companies give their connections back. */
const POOL_IDLE_SECONDS = 60;

/**
 * How long an evicted pool stays open before it is closed. Requests that already hold it can finish
 * their remaining statements; a request is far shorter than this (PR #6 review). Retiring pools
 * still hold connections, so size TENANT_POOL_CACHE above the number of companies active at once.
 */
const EVICTION_GRACE_MS = 30_000;

/**
 * The only way to reach a company database (CLAUDE.md rule 2; blueprint P9). It takes a
 * TenantContext, which only TenantGuard makes from the verified session, so the company always
 * comes from the session. Connection strings are stored encrypted with AES-256-GCM and decrypted
 * here only. Pools are cached per company with an LRU of TENANT_POOL_CACHE entries; an evicted
 * pool is closed after a grace period, so requests that still hold it can finish.
 */
/** An evicted pool waiting out its grace period, with the timer that will close it. */
interface RetiringPool {
  handle: DbHandle<CompanyDb>;
  timer: NodeJS.Timeout;
}

@Injectable()
export class TenantConnectionService implements OnApplicationShutdown {
  private readonly logger = new Logger("Tenancy");
  private readonly pools: LruCache<string, DbHandle<CompanyDb>>;
  /** Pools being opened, so parallel first requests for one company share one pool. */
  private readonly opening = new Map<string, Promise<DbHandle<CompanyDb>>>();
  /**
   * Evicted pools in their grace period, by company and oldest first. A company asked for again
   * takes its pool back instead of opening a second one. There are never more than the cache
   * limit, so open connections stay at most twice TENANT_POOL_CACHE pools (PR #6 re-review).
   */
  private readonly retiring = new Map<string, RetiringPool>();
  private readonly limit: number;
  private readonly encryptionKey: string;

  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    config: ConfigService<ApiEnv, true>,
  ) {
    this.encryptionKey = config.get("CONNECTION_ENCRYPTION_KEY", { infer: true });
    this.limit = config.get("TENANT_POOL_CACHE", { infer: true });
    this.pools = new LruCache(this.limit, (handle, companyId) => this.retire(companyId, handle));
  }

  /**
   * The database of the request's company. 503 `company_unavailable` while it is not ready. Only a
   * TenantContext made by TenantGuard is accepted; a look-alike object throws, even if a cast got it
   * past the compiler (CLAUDE.md rule 2).
   */
  async db(tenant: TenantContext): Promise<CompanyDb> {
    if (!TenantContext.isVerified(tenant)) throw new Error("TenantConnectionService needs a verified TenantContext.");
    const companyId = tenant.companyId;
    const cached = this.pools.get(companyId) ?? this.takeBack(companyId);
    if (cached) return cached.db;
    let pending = this.opening.get(companyId);
    if (!pending) {
      pending = this.open(companyId).finally(() => this.opening.delete(companyId));
      this.opening.set(companyId, pending);
    }
    return (await pending).db;
  }

  /** How many company pools are cached; for tests and health. */
  get openPools(): number {
    return this.pools.size;
  }

  /** How many evicted pools are still in their grace period; for tests and health. */
  get retiringPools(): number {
    return this.retiring.size;
  }

  async onApplicationShutdown(): Promise<void> {
    const handles = [...this.pools.drain()];
    for (const { handle, timer } of this.retiring.values()) {
      clearTimeout(timer);
      handles.push(handle);
    }
    this.retiring.clear();
    await Promise.all(handles.map((handle) => handle.close()));
  }

  private async open(companyId: string): Promise<DbHandle<CompanyDb>> {
    const [row] = await this.control.db
      .select({ encryptedUrl: tenantDatabases.encryptedUrl, status: tenantDatabases.status })
      .from(tenantDatabases)
      .where(eq(tenantDatabases.tenantId, companyId));
    if (!row || !isDatabaseUsable(row.status)) throw companyUnavailable();
    const handle = openCompanyDb(decryptSecret(row.encryptedUrl, this.encryptionKey), {
      max: POOL_SIZE,
      idleTimeoutSeconds: POOL_IDLE_SECONDS,
    });
    this.pools.set(companyId, handle);
    return handle;
  }

  /** Moves a retiring pool back into the cache, or returns undefined when there is none. */
  private takeBack(companyId: string): DbHandle<CompanyDb> | undefined {
    const retiring = this.retiring.get(companyId);
    if (!retiring) return undefined;
    clearTimeout(retiring.timer);
    this.retiring.delete(companyId);
    this.pools.set(companyId, retiring.handle);
    return retiring.handle;
  }

  /** Keeps an evicted pool open for its grace period; the oldest closes at once when too many wait. */
  private retire(companyId: string, handle: DbHandle<CompanyDb>): void {
    const timer = setTimeout(() => this.closeRetiring(companyId), EVICTION_GRACE_MS);
    timer.unref();
    this.retiring.set(companyId, { handle, timer });
    if (this.retiring.size > this.limit) {
      const [oldest] = this.retiring.keys();
      this.closeRetiring(oldest);
    }
  }

  private closeRetiring(companyId: string): void {
    const retiring = this.retiring.get(companyId);
    if (!retiring) return;
    clearTimeout(retiring.timer);
    this.retiring.delete(companyId);
    // Never logs the company or its connection string, only that a close failed.
    retiring.handle.close().catch(() => this.logger.warn("Could not close an evicted company pool."));
  }
}
