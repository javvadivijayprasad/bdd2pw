/**
 * Tests for the v2.0.1 newline-flattening helper. Tiny and surgical —
 * the function is one regex pair, but the bug it prevents is severe
 * (uncompilable .spec.ts files), so it's worth a dedicated test file
 * so future refactors can't silently break the contract.
 */

import { describe, it, expect } from "vitest";
import { flattenForComment } from "../../src/utils/commentSafe";

describe("flattenForComment", () => {
  it("returns the input unchanged when it has no newlines", () => {
    expect(flattenForComment("hello world")).toBe("hello world");
  });

  it("collapses LF newlines into ' | ' separators", () => {
    expect(flattenForComment("line1\nline2")).toBe("line1 | line2");
  });

  it("normalises CRLF before collapsing", () => {
    expect(flattenForComment("line1\r\nline2")).toBe("line1 | line2");
  });

  it("collapses multiple consecutive newlines into a single separator", () => {
    expect(flattenForComment("line1\n\n\nline2")).toBe("line1 | line2");
  });

  it("trims surrounding whitespace", () => {
    expect(flattenForComment("  hello  ")).toBe("hello");
  });

  it("returns empty string for null/undefined", () => {
    expect(flattenForComment(undefined)).toBe("");
    expect(flattenForComment(null)).toBe("");
  });

  it("stringifies non-string inputs", () => {
    expect(flattenForComment(42)).toBe("42");
    expect(flattenForComment({ foo: 1 })).toBe("[object Object]");
  });

  it("handles the exact bug case — better-sqlite3 NODE_MODULE_VERSION mismatch", () => {
    const err =
      "The module '/work/node_modules/better-sqlite3/build/Release/better_sqlite3.node'\n" +
      "was compiled against a different Node.js version using\n" +
      "NODE_MODULE_VERSION 127. This version of Node.js requires\n" +
      "NODE_MODULE_VERSION 115. Please try re-compiling or re-installing\n" +
      "the module (for instance, using `npm rebuild` or `npm install`).";
    const out = flattenForComment(err);
    // The single-line output is safe to embed in a `// TODO: ...` comment.
    expect(out).not.toContain("\n");
    expect(out).not.toContain("\r");
    // All five lines are still present, separated by ` | `.
    expect(out.split(" | ")).toHaveLength(5);
    // Round-trips with the embedding pattern produce a single-line comment.
    const wrapped = `// TODO: ${out}`;
    expect(wrapped.split("\n")).toHaveLength(1);
    expect(wrapped.startsWith("// TODO:")).toBe(true);
  });
});
