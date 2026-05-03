import type { SourceId } from '../../../core/types/index.ts';

const DB_NAME = 'log-viewer-handles';
const STORE_NAME = 'source_handles';
const DB_VERSION = 1;

export interface PersistedSourceHandle {
  readonly sourceId: SourceId;
  readonly kind: 'directory' | 'file';
  readonly name: string;
  readonly handle: FileSystemDirectoryHandle | FileSystemFileHandle;
  readonly createdAt: number;
}

const openIDB = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'sourceId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const promisifyTx = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

const awaitRequest = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export class HandleStore {
  private readonly db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.db = db;
  }

  static async open(): Promise<HandleStore> {
    return new HandleStore(await openIDB());
  }

  async put(record: PersistedSourceHandle): Promise<void> {
    const tx = this.db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    await promisifyTx(tx);
  }

  async get(sourceId: SourceId): Promise<PersistedSourceHandle | null> {
    const tx = this.db.transaction(STORE_NAME, 'readonly');
    const value = await awaitRequest(tx.objectStore(STORE_NAME).get(sourceId));
    return (value as PersistedSourceHandle | undefined) ?? null;
  }

  async delete(sourceId: SourceId): Promise<void> {
    const tx = this.db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(sourceId);
    await promisifyTx(tx);
  }

  async list(): Promise<ReadonlyArray<PersistedSourceHandle>> {
    const tx = this.db.transaction(STORE_NAME, 'readonly');
    const value = await awaitRequest(tx.objectStore(STORE_NAME).getAll());
    return (value as ReadonlyArray<PersistedSourceHandle>) ?? [];
  }

  async clearAll(): Promise<void> {
    const tx = this.db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    await promisifyTx(tx);
  }
}
