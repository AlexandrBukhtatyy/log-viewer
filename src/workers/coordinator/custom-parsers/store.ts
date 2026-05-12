import type { CustomParserDef } from '../../../core/parsers/custom-parser-def.ts';

const DB_NAME = 'log-viewer-custom-parsers';
const STORE_NAME = 'parsers';
const DB_VERSION = 1;

/**
 * Per-workspace storage for user-defined parser definitions
 * (Phase 2.C). Lives in IndexedDB so persistence works in any
 * browsing-data backup the user keeps; that's also why it's a
 * separate DB from `log-viewer-handles` — clearing only OPFS
 * (e.g. after a SQLite-corrupt rebuild) must not wipe parser
 * definitions, which the user could spend real time crafting.
 */

const openIDB = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
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

export class CustomParserStore {
  private readonly db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.db = db;
  }

  static async open(): Promise<CustomParserStore> {
    return new CustomParserStore(await openIDB());
  }

  async put(def: CustomParserDef): Promise<void> {
    const tx = this.db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(def);
    await promisifyTx(tx);
  }

  async get(id: string): Promise<CustomParserDef | null> {
    const tx = this.db.transaction(STORE_NAME, 'readonly');
    const value = await awaitRequest(tx.objectStore(STORE_NAME).get(id));
    return (value as CustomParserDef | undefined) ?? null;
  }

  async delete(id: string): Promise<void> {
    const tx = this.db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    await promisifyTx(tx);
  }

  async list(): Promise<ReadonlyArray<CustomParserDef>> {
    const tx = this.db.transaction(STORE_NAME, 'readonly');
    const value = await awaitRequest(tx.objectStore(STORE_NAME).getAll());
    return (value as ReadonlyArray<CustomParserDef>) ?? [];
  }

  async clearAll(): Promise<void> {
    const tx = this.db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    await promisifyTx(tx);
  }
}
