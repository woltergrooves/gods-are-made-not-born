// IndexedDB storage with a localStorage fallback (private browsing on some iOS versions).

import type { StorageAdapter } from '../save/SaveCore.js';

export class IdbStorage implements StorageAdapter {
  private db: Promise<IDBDatabase | null>;

  constructor(name = 'gods-are-made-not-born') {
    this.db = new Promise((resolve) => {
      try {
        const req = indexedDB.open(name, 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch { resolve(null); }
    });
  }

  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db;
    if (!db) throw new Error('no-idb');
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction('kv', mode);
      const req = fn(t.objectStore('kv'));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  async get(key: string): Promise<string | null> {
    try { return ((await this.tx('readonly', (s) => s.get(key))) as string | undefined) ?? null; }
    catch { return localStorage.getItem(key); }
  }
  async set(key: string, value: string): Promise<void> {
    try { await this.tx('readwrite', (s) => s.put(value, key)); }
    catch { localStorage.setItem(key, value); }
  }
  async remove(key: string): Promise<void> {
    try { await this.tx('readwrite', (s) => s.delete(key)); } catch { /* ignore */ }
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }
  async keys(): Promise<string[]> {
    try { return (await this.tx('readonly', (s) => s.getAllKeys())).map(String); }
    catch { return Object.keys(localStorage); }
  }
}
