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
import { flattenForComment } from "../utils/commentSafe";

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
 * Result returned by openSqliteCache — exposes both the cache and whether
 * the SQLite backend was actually loaded (vs. having fallen back to
 * in-memory). Callers use the flag to log a single warning per scaffold
 * run, not per LLM call.
 */
export interface OpenCacheResult {
  cache: BindingCache;
  /** True when the SQLite backend loaded successfully. */
  persistent: boolean;
  /**
   * When persistent === false, this carries the underlying load error so
   * the caller can log a useful warning (e.g. "NODE_MODULE_VERSION 127
   * mismatch — re-run with `npm rebuild better-sqlite3`").
   */
  fallbackReason?: string;
}

/**
 * Open a SQLite-backed cache at the given path. `better-sqlite3` is an
 * optional dep; the load can fail for several reasons:
 *
 *   1. Module not installed at all (`require("better-sqlite3")` throws).
 *   2. Module loads (JS) but the native `.node` binding doesn't —
 *      classic NODE_MODULE_VERSION mismatch when a Node 22-prebuilt
 *      binary runs in a Node 18 / 20 environment.
 *   3. File system errors — `ensureDir` denied, read-only mount, etc.
 *   4. Corrupted .sqlite file from a previous run.
 *
 * v2.0.2: ALL of these now fall back to an in-memory cache. v2.0/2.0.1
 * only caught case 1 — case 2 (the common one in cloud-jobs runs)
 * propagated up and aborted the entire LLM fallback. See CHANGELOG.
 *
 * The caller decides whether to log/surface the fallback by inspecting
 * `result.persistent` and `result.fallbackReason`.
 */
export async function openSqliteCache(
  cachePath: string,
  /**
   * Test-only injection point. Production callers leave this undefined
   * and we use `require("better-sqlite3")` directly. Tests pass a
   * throwing stub to simulate native binding load failures (vi.mock
   * doesn't intercept require()). Not part of the public API.
   */
  _loader?: () => unknown,
): Promise<OpenCacheResult> {
  // Special case: ":memory:" → always in-memory, no disk.
  if (cachePath === ":memory:") {
    return { cache: new InMemoryCache(), persistent: false };
  }

  try {
    // better-sqlite3 is in optionalDependencies. require() so a missing
    // module doesn't break import-time of this file.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sqlite = _loader
      ? (_loader() as any)
      : (require("better-sqlite3") as any);

    await fs.ensureDir(path.dirname(cachePath));
    // v2.0.2: this line in particular is what previously escaped the
    // try/catch — `sqlite(cachePath)` triggers the native binding load,
    // which throws on NODE_MODULE_VERSION mismatch.
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

    const cache: BindingCache = {
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
    return { cache, persistent: true };
  } catch (err) {
    // ANY failure during SQLite setup → fall back to in-memory.
    // Bindings won't persist across runs; LLM is called every time
    // (subject to the per-scaffold cache the InMemoryCache still
    // provides within a single run). The scaffolder still works.
    //
    // Use flattenForComment (the same helper that protects // TODO
    // lines in 2.0.1) so the fallback reason is single-line but
    // PRESERVES all the diagnostic info — a typical native-binding
    // load error spans 4-5 lines, and the most useful piece
    // (NODE_MODULE_VERSION number) is on line 3. `.split("\n")[0]`
    // would lose it; flattenForComment keeps everything joined
    // with ` | ` separators.
    return {
      cache: new InMemoryCache(),
      persistent: false,
      fallbackReason: flattenForComment(
        err instanceof Error ? err.message : err,
      ),
    };
  }
}
