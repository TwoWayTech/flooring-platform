import type { DatabaseProvisioner, ProvisionRequest, ProvisionedDatabase } from "./types";

const NEON_API = "https://console.neon.tech/api/v2";

/** Settings for the Neon adapter. */
export interface NeonOptions {
  apiKey: string;
  /** A US region such as aws-us-east-2 (blueprint: company data stays in the US). */
  region: string;
  /** Replaced in tests. */
  fetch?: typeof fetch;
}

interface CreatedProject {
  project: { id: string };
  databases: { name: string }[];
  roles: { name: string }[];
}

/**
 * One Neon project per company (blueprint "Provider portability"). Returns the pooled
 * connection URL, because the API keeps one pool per company and Neon's pooler absorbs bursts.
 */
export class NeonProvisioner implements DatabaseProvisioner {
  private readonly fetch: typeof fetch;

  constructor(private readonly options: NeonOptions) {
    this.fetch = options.fetch ?? fetch;
  }

  /** Creates the project on PostgreSQL 16 and asks Neon for its pooled URL. */
  async create({ tenantId, slug }: ProvisionRequest): Promise<ProvisionedDatabase> {
    const created = await this.call<CreatedProject>("POST", "/projects", {
      project: { name: `company-${slug}-${tenantId}`, region_id: this.options.region, pg_version: 16 },
    });
    const projectId = created.project.id;
    const query = new URLSearchParams({
      database_name: created.databases[0]?.name ?? "neondb",
      role_name: created.roles[0]?.name ?? "neondb_owner",
      pooled: "true",
    });
    const { uri } = await this.call<{ uri: string }>("GET", `/projects/${projectId}/connection_uri?${query}`);
    return { providerRef: projectId, connectionUrl: uri };
  }

  /** Deletes the project. Neon keeps it recoverable for 7 days; a project already gone is fine. */
  async drop(providerRef: string): Promise<void> {
    await this.call("DELETE", `/projects/${encodeURIComponent(providerRef)}`, undefined, [404]);
  }

  private async call<T>(method: string, path: string, body?: unknown, allowed: number[] = []): Promise<T> {
    const response = await this.fetch(`${NEON_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok && !allowed.includes(response.status)) {
      throw new Error(`Neon API ${method} ${path.split("?")[0]} failed with ${response.status}.`);
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  }
}
