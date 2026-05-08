/**
 * v2.0.2 regression test — when the SQLite cache backend fails to load
 * (the classic NODE_MODULE_VERSION mismatch from a Playwright base
 * image), bdd2pw must still call the LLM provider. v2.0.0/2.0.1 had a
 * silent abort: the cache-load error escaped through generateBinding,
 * got caught at the matchStepWithLLM outer try/catch, and the provider
 * was never called.
 *
 * The fix is in src/llm/cache.ts — try/catch now wraps the FULL SQLite
 * setup including `sqlite(cachePath)` which is where the native binding
 * actually loads.
 *
 * This test mocks `better-sqlite3` to throw on instantiation (mirroring
 * the production failure mode) and asserts:
 *   1. openSqliteCache returns successfully with persistent=false.
 *   2. The returned cache works (in-memory), supporting get/set.
 *   3. fallbackReason is populated with the underlying error text.
 */

import { describe, it, expect } from "vitest";
import * as path from "path";
import * as os from "os";
import { openSqliteCache, InMemoryCache } from "../../src/llm/cache";

/**
 * Stub loader that simulates the production failure mode. Returns a
 * function (mirroring better-sqlite3's default export, a constructor)
 * that throws on instantiation — matching what happens when the .node
 * native binding's NODE_MODULE_VERSION doesn't match the running Node.
 *
 * The cache module accepts an optional `_loader` parameter (test-only
 * injection point — vi.mock can't intercept require()).
 */
function throwingLoader() {
  return function FakeBetterSqlite3() {
    throw new Error(
      "The module '/work/node_modules/better-sqlite3/build/Release/better_sqlite3.node'\n" +
        "was compiled against a different Node.js version using\n" +
        "NODE_MODULE_VERSION 127. This version of Node.js requires\n" +
        "NODE_MODULE_VERSION 115. Please try re-compiling.",
    );
  };
}

describe("v2.0.2 — cache backend graceful degradation", () => {
  it("returns persistent=false + InMemoryCache when better-sqlite3 throws on construction", async () => {
    const tmpPath = path.join(os.tmpdir(), `bdd2pw-cache-test-${Date.now()}.sqlite`);
    const result = await openSqliteCache(tmpPath, throwingLoader);

    // Bug fix: this used to throw and propagate up to abort the LLM call.
    // After 2.0.2 it returns a working in-memory cache.
    expect(result.persistent).toBe(false);
    expect(result.cache).toBeInstanceOf(InMemoryCache);
    expect(result.fallbackReason).toBeTruthy();
    expect(result.fallbackReason).toContain("NODE_MODULE_VERSION");
    // Reason is a single line — multi-line stack traces would be hostile
    // to log output.
    expect(result.fallbackReason).not.toContain("\n");
  });

  it("the fallback in-memory cache supports get/set normally", async () => {
    const tmpPath = path.join(os.tmpdir(), `bdd2pw-cache-test-fallback-${Date.now()}.sqlite`);
    const result = await openSqliteCache(tmpPath, throwingLoader);
    expect(result.persistent).toBe(false);
    const { cache } = result;

    // Empty initially.
    expect(await cache.get("key")).toBeUndefined();
    expect(await cache.size()).toBe(0);

    // Set + get round-trip.
    await cache.set("key", {
      binding: {
        step: { keyword: "When", text: "x" },
        pomCall: { page: "p", method: "m", args: [] },
      },
      model: "test-model",
      createdAt: new Date().toISOString(),
    });
    expect(await cache.size()).toBe(1);
    const out = await cache.get("key");
    expect(out?.binding.pomCall?.method).toBe("m");
    expect(out?.model).toBe("test-model");

    await cache.close(); // no-op for in-memory, but should not throw.
  });

  it(":memory: cache path always returns InMemoryCache (no SQLite load attempt)", async () => {
    const result = await openSqliteCache(":memory:");
    expect(result.cache).toBeInstanceOf(InMemoryCache);
    expect(result.persistent).toBe(false);
    // No fallback REASON because we didn't try-and-fail; we deliberately
    // chose in-memory.
    expect(result.fallbackReason).toBeUndefined();
  });
});
