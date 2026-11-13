import { Inject, Injectable, Logger, ServiceUnavailableException, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { decryptSecret, openCompanyDb, type CompanyDb, type ControlDb, type DbHandle } from "@workspace/db";
import { tenantDatabases } from "@workspace/db/control";
import { eq } from "drizzle-orm";
import type { ApiEnv } from "../config/env";
import { CONTROL_DB } from "../database/control-db";
import { LruCache } from "./lru-cache";
import type { TenantContext } from "./tenant-context";

/** Connections per company pool; small, because many companies share one API instance. */
const POOL_SIZE = 3;

/** Database statuses a request may use; `read_only` is enforced by TenantGuard. */
const USABLE: ReadonlySet<string> = new Set(["ready", "read_only"]);

/**
 * The only way to reach a company database (CLAUDE.md rule 2; blueprint P9). It takes a
 * TenantContext, which only TenantGuard makes from the verified session, so the company always
 * comes from the session. Connection strings are stored encrypted with AES-256-GCM and decrypted
 * here only. Pools are cached per company with an LRU of TENANT_POOL_CACHE entries; an evicted
 * pool is closed after its running queries finish.
 */
@Injectable()
export class TenantConnectionService implements OnApplicationShutdown {
  private readonly logger = new Logger("Tenancy");
  private readonly pools: LruCache<string, DbHandle<CompanyDb>>;
  /** Pools being opened, so parallel first requests for one company share one pool. */
  private readonly opening = new Map<string, Promise<DbHandle<CompanyDb>>>();
  private readonly encryptionKey: string;

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
    await Promise.all(this.pools.drain().map((handle) => handle.close()));
  }

  private async open(companyId: string): Promise<DbHandle<CompanyDb>> {
    const [row] = await this.control.db
      .select({ encryptedUrl: tenantDatabases.encryptedUrl, status: tenantDatabases.status })
      .from(tenantDatabases)
      .where(eq(tenantDatabases.tenantId, companyId));
    if (!row || !USABLE.has(row.status)) {
      throw new ServiceUnavailableException({
        code: "company_unavailable",
        message: "Your company's data is not available right now. Please try again in a few minutes.",
      });
    }
    const handle = openCompanyDb(decryptSecret(row.encryptedUrl, this.encryptionKey), { max: POOL_SIZE });
    this.pools.set(companyId, handle);
    return handle;
  }

  private close(handle: DbHandle<CompanyDb>): void {
    // Never logs the company or its connection string, only that a close failed.
    handle.close().catch(() => this.logger.warn("Could not close an evicted company pool."));
  }
}
