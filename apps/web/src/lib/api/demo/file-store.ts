import { ApiError } from "../errors";

/**
 * Where proof files live (spec Appendix A "Files and storage"): behind this small interface, so
 * object storage such as S3 can replace the browser's IndexedDB without touching any screen.
 */
export interface FileStore {
  put(id: string, file: Blob): Promise<void>;
  get(id: string): Promise<Blob | undefined>;
  remove(ids: readonly string[]): Promise<void>;
  clear(): Promise<void>;
}

const DB_NAME = "fp-demo-files";
const STORE = "files";

/** Raised when the browser has no room left for files; the message says what to do. */
export class StorageFullError extends ApiError {
  constructor() {
    super("This browser has no room left for files. Remove old files or reset the demo data, then try again.");
  }
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Files could not be opened."));
  });
}

/** Runs one request in a transaction and resolves with its result. */
async function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = work(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(request ? request.result : undefined);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      const error = tx.error;
      reject(
        error?.name === "QuotaExceededError"
          ? new StorageFullError()
          : (error ?? new Error("Files could not be saved.")),
      );
    };
  });
}

/** The demo's file store: IndexedDB in this browser, kept apart from the localStorage overlay. */
export const indexedDbFileStore: FileStore = {
  async put(id, file) {
    await run("readwrite", (store) => store.put(file, id));
  },
  async get(id) {
    return (await run<Blob>("readonly", (store) => store.get(id))) ?? undefined;
  },
  async remove(ids) {
    await run("readwrite", (store) => {
      for (const id of ids) store.delete(id);
    });
  },
  async clear() {
    await run("readwrite", (store) => store.clear());
  },
};
