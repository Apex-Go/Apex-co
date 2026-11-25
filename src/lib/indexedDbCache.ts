import { Candle, Timeframe } from '../types/trading';

const DB_NAME = 'apex_confluence_cache_v1';
const STORE_CANDLES = 'candles';
const DB_VERSION = 1;

function openCacheDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_CANDLES)) {
          db.createObjectStore(STORE_CANDLES, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function getCachedCandles(symbol: string, timeframe: Timeframe): Promise<Candle[] | null> {
  const db = await openCacheDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_CANDLES, 'readonly');
      const store = tx.objectStore(STORE_CANDLES);
      const req = store.get(`${symbol}:${timeframe}`);
      req.onsuccess = () => {
        const val = req.result as { key: string; candles: Candle[]; updatedAt: number } | undefined;
        resolve(val?.candles ?? null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function setCachedCandles(symbol: string, timeframe: Timeframe, candles: Candle[]): Promise<void> {
  const db = await openCacheDb();
  if (!db || candles.length === 0) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_CANDLES, 'readwrite');
      const store = tx.objectStore(STORE_CANDLES);
      store.put({
        key: `${symbol}:${timeframe}`,
        candles: candles.slice(-8000),
        updatedAt: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
