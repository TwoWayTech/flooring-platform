import type { SignedUrlOptions, StorageProvider, StoredObject } from "./types";

/** Files kept in memory, for tests and local runs without a bucket. Lost when the process ends. */
export class MemoryStorageProvider implements StorageProvider {
  private readonly files = new Map<string, StoredObject>();

  /** Stores a copy of the bytes, so later changes to the caller's buffer do not leak in. */
  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    this.files.set(key, { body: body.slice(), contentType });
  }

  /** Returns the stored file or null. */
  async get(key: string): Promise<StoredObject | null> {
    return this.files.get(key) ?? null;
  }

  /** Forgets the file. */
  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }

  /** A memory:// link that names the key; nothing can open it, which is enough for tests. */
  async signedUrl(key: string, { method, expiresInSeconds }: SignedUrlOptions): Promise<string> {
    return `memory://${encodeURIComponent(key)}?method=${method}&expires=${expiresInSeconds}`;
  }
}
