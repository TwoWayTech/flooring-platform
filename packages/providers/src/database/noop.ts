import type { DatabaseProvisioner, ProvisionRequest, ProvisionedDatabase } from "./types";

/**
 * A provisioner that creates nothing: every company gets the same URL. For tests that need a
 * provisioner but not a new database, and records what was asked so tests can check it.
 */
export class NoopProvisioner implements DatabaseProvisioner {
  readonly created: ProvisionRequest[] = [];
  readonly dropped: string[] = [];

  constructor(private readonly connectionUrl = "postgres://noop@localhost/noop") {}

  /** Records the request and returns the fixed URL. */
  async create(request: ProvisionRequest): Promise<ProvisionedDatabase> {
    this.created.push(request);
    return { providerRef: `noop_${request.slug}`, connectionUrl: this.connectionUrl };
  }

  /** Records the reference. */
  async drop(providerRef: string): Promise<void> {
    this.dropped.push(providerRef);
  }
}
