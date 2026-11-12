/** What a provisioner needs to create one company's database. */
export interface ProvisionRequest {
  /** The company's id in the control database; it names the database so it can be traced back. */
  tenantId: string;
  /** Lower-case letters, digits and underscores; used in database, role and project names. */
  slug: string;
}

/** A company database the provisioner created. */
export interface ProvisionedDatabase {
  /** The provider's own handle (a Neon project id, a database name), stored to drop it later. */
  providerRef: string;
  /** A pooled connection URL with credentials; the caller encrypts it before storing it. */
  connectionUrl: string;
}

/**
 * Creates and removes company databases. Nothing else in the code calls a database provider's
 * API (blueprint "Provider portability", rule 3), so moving providers means writing one adapter.
 */
export interface DatabaseProvisioner {
  /** Creates an empty database with its own login, ready for migrations. */
  create(request: ProvisionRequest): Promise<ProvisionedDatabase>;
  /** Removes the database and its login. Removing one that is already gone is not an error. */
  drop(providerRef: string): Promise<void>;
}
