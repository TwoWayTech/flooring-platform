/** A stored file as read back. */
export interface StoredObject {
  body: Uint8Array;
  contentType: string;
}

/** What a time-limited link lets its holder do. */
export interface SignedUrlOptions {
  method: "get" | "put";
  expiresInSeconds: number;
  /** Required for an upload link so the browser cannot send another type. */
  contentType?: string;
}

/**
 * File storage for logos, photos, proofs and documents (blueprint "Provider portability", rule
 * 4). Keys start with the tenant id so one company's files never share a prefix with another's.
 */
export interface StorageProvider {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Returns null when no file has that key. */
  get(key: string): Promise<StoredObject | null>;
  /** Deleting a missing key is not an error. */
  delete(key: string): Promise<void>;
  /** A link the browser uses directly, so large files never pass through the API. */
  signedUrl(key: string, options: SignedUrlOptions): Promise<string>;
}
