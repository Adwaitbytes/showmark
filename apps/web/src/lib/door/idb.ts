import type { QueuedAttestation, QueueStore } from "./queue";

// IndexedDB backing for the offline door queue. IndexedDB, not localStorage, because a busy door can hold hundreds of
// signed check-ins and they must survive a closed tab, a dead battery and a browser restart.

const DB_NAME = "showmark-door";
const DB_VERSION = 1;
const STORE = "attestations";
const BY_EVENT = "byEvent";

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex(BY_EVENT, "eventId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the door queue"));
    request.onblocked = () => reject(new Error("The door queue is open in an older tab. Close other door tabs and reload."));
  });
}

export function indexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

export class IndexedDbQueueStore implements QueueStore {
  private db: Promise<IDBDatabase> | null = null;

  private database(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = open().catch((error: unknown) => {
        // Let the next call try again instead of caching a failure forever.
        this.db = null;
        throw error;
      });
    }
    return this.db;
  }

  async get(id: string): Promise<QueuedAttestation | undefined> {
    const db = await this.database();
    return promisify<QueuedAttestation | undefined>(db.transaction(STORE, "readonly").objectStore(STORE).get(id));
  }

  async put(record: QueuedAttestation): Promise<void> {
    const db = await this.database();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    await done(tx);
  }

  async listByEvent(eventId: string): Promise<QueuedAttestation[]> {
    const db = await this.database();
    return promisify<QueuedAttestation[]>(db.transaction(STORE, "readonly").objectStore(STORE).index(BY_EVENT).getAll(eventId));
  }

  async delete(id: string): Promise<void> {
    const db = await this.database();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    await done(tx);
  }
}
