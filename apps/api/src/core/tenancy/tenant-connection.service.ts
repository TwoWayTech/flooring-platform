import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { decryptSecret, openCompanyDb, type CompanyDb, type ControlDb, type DbHandle } from "@workspace/db";
import { tenantDatabases } from "@workspace/db/control";
import { eq } from "drizzle-orm";
import type { ApiEnv } from "../config/env";
import { CONTROL_DB } from "../database/control-db";
import { companyUnavailable } from "./company-unavailable";
import { LruCache } from "./lru-cache";
import type { TenantContext } from "./tenant-context";
import { isDatabaseUsable } from "./tenant-directory";

/** Connections per company pool; small, because many companies share one API instance. */
const POOL_SIZE = 3;

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
@Injectable()
export class TenantConnectionService implements OnApplicationShutdown {
  private readonly logger = new Logger("Tenancy");
  private readonly pools: LruCache<string, DbHandle<CompanyDb>>;
  /** Pools being opened, so parallel first requests for one company share one pool. */
  private readonly opening = new Map<string, Promise<DbHandle<CompanyDb>>>();
  private readonly encryptionKey: string;
  /** Evicted pools waiting out their grace period, closed at once on shutdown. */
  private readonly retiring = new Set<DbHandle<CompanyDb>>();

  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    config: ConfigService<ApiEnv, true>,
  ) {
    this.encryptionKey = config.get("CONNECTION_ENCRYPTION_KEY", { infer: true });
    this.pools = new LruCache(config.get("TENANT_POOL_CACHE", { infer: true }), (handle) => this.close(handle));
  }

  /** The database of the request's company. 503 `company_unavailable` while it is not ready. */
  async db(tenant: TenantContext): Promise<CompanyDb> {
    const cached = this.pools.get(tenant.companyId);
    if (cached) return cached.db;
    let pending = this.opening.get(tenant.companyId);
    if (!pending) {
      pending = this.open(tenant.companyId).finally(() => this.opening.delete(tenant.companyId));
      this.opening.set(tenant.companyId, pending);
    }
    return (await pending).db;
  }

  /** How many company pools are open; for tests and health. */
  get openPools(): number {
    return this.pools.size;
  }

  async onApplicationShutdown(): Promise<void> {
    const handles = [...this.pools.drain(), ...this.retiring];
    this.retiring.clear();
    await Promise.all(handles.map((handle) => handle.close()));
  }

  private async open(companyId: string): Promise<DbHandle<CompanyDb>> {
    const [row] = await this.control.db
      .select({ encryptedUrl: tenantDatabases.encryptedUrl, status: tenantDatabases.status })
      .from(tenantDatabases)
      .where(eq(tenantDatabases.tenantId, companyId));
    if (!row || !isDatabaseUsable(row.status)) throw companyUnavailable();
    const handle = openCompanyDb(decryptSecret(row.encryptedUrl, this.encryptionKey), { max: POOL_SIZE });
    this.pools.set(companyId, handle);
    return handle;
  }

  private close(handle: DbHandle<CompanyDb>): void {
    this.retiring.add(handle);
    const timer = setTimeout(() => {
      if (!this.retiring.delete(handle)) return;
      // Never logs the company or its connection string, only that a close failed.
      handle.close().catch(() => this.logger.warn("Could not close an evicted company pool."));
    }, EVICTION_GRACE_MS);
    timer.unref();
  }
}
