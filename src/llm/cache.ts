/**
 * SQLite-backed cache for LLM-generated step bindings.
 *
 * Why SQLite (not JSON file): better-sqlite3 already an optional dep,
 * cheap concurrent reads, single-file, plays nicely with the .gitignore
 * we already have for `.bdd2pw/`.
 *
 * Schema:
 *   llm_cache(
 *     key TEXT PRIMARY KEY,    -- hash(model + step text + POM signature)
 *     value TEXT,              -- JSON-stringified StepBinding
 *     model TEXT,              -- LLM model identifier (audit only)
 *     created_at TEXT          -- ISO-8601 timestamp
 *   )
 *
 * Cache invalidation: keys include the model name, so swapping models
 * (e.g. claude-sonnet-4-6 → claude-opus-4-6) invalidates old entries
 * automatically. To force a full reset, delete the file.
 */

import * as fs from "fs-extra";
import * as path from "path";
import type { StepBinding } from "../types";

export interface CacheEntry {
  binding: StepBinding;
  model: string;
  createdAt: string;
}

export interface BindingCache {
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, value: CacheEntry): Promise<void>;
  size(): Promise<number>;
  close(): Promise<void>;
}

/**
 * In-memory cache — used when SQLite isn't available (better-sqlite3
 * not installed) or when the caller passes :memory: as the path. Tests
 * use this exclusively to avoid filesystem I/O.
 */
export class InMemoryCache implements BindingCache {
  private store = new Map<string, CacheEntry>();
  async get(key: string): Promise<CacheEntry | undefined> {
    return this.store.get(key);
  }
  async set(key: string, value: CacheEntry): Promise<void> {
    this.store.set(key, value);
  }
  async size(): Promise<number> {
    return this.store.size;
  }
  async close(): Promise<void> {
    /* nothing to close */
  }
}

/**
 * Open a SQLite-backed cache at the given path. better-sqlite3 is an
 * optional dep; if it's not installed (or load fails), fall back to an
 * in-memory cache and warn. The caller can detect the fallback by checking
 * if `cache instanceof InMemoryCache` (or just observe that bindings
 * aren't reused across runs).
 */
export async function openSqliteCache(
  cachePath: string,
): Promise<BindingCache> {
  // Special case: ":memory:" → always in-memory, no disk.
  if (cachePath === ":memory:") {
    return new InMemoryCache();
  }

  let sqlite: any;
  try {
    // better-sqlite3 is in optionalDependencies. require() so a missing
    // module doesn't break import-time of this file.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    sqlite = require("better-sqlite3");
  } catch {
    // Fall back to in-memory if the optional dep isn't installed. This
    // means LLM bindings won't persist across runs — every call hits the
    // provider — but the scaffolder still works.
    return new InMemoryCache();
  }

  await fs.ensureDir(path.dirname(cachePath));
  const db = sqlite(cachePath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_cache (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      model      TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  const getStmt = db.prepare(
    "SELECT value, model, created_at FROM llm_cache WHERE key = ?",
  );
  const setStmt = db.prepare(
    "INSERT OR REPLACE INTO llm_cache (key, value, model, created_at) VALUES (?, ?, ?, ?)",
  );
  const sizeStmt = db.prepare("SELECT COUNT(*) AS n FROM llm_cache");

  return {
    async get(key) {
      const row = getStmt.get(key) as
        | { value: string; model: string; created_at: string }
        | undefined;
      if (!row) return undefined;
      try {
        return {
          binding: JSON.parse(row.value),
          model: row.model,
          createdAt: row.created_at,
        };
      } catch {
        // Corrupted row — pretend it doesn't exist.
        return undefined;
      }
    },
    async set(key, entry) {
      setStmt.run(
        key,
        JSON.stringify(entry.binding),
        entry.model,
        entry.createdAt,
      );
    },
    async size() {
      const row = sizeStmt.get() as { n: number };
      return row.n;
    },
    async close() {
      db.close();
    },
  };
}
