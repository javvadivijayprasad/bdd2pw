/**
 * v4.2.0 — DOM snapshot hash header for POM drift detection.
 *
 * The four unit functions under test:
 *   - computeDomHash(snapshot): deterministic sha256 of accessibility tree
 *   - buildDomHashHeader(hash, url, at?): the JSDoc-formatted comment block
 *   - extractDomHashFromPom(contents): reverse — pulls hash from an existing POM
 *   - prependDomHashHeader(contents, header): idempotent header injection
 *
 * Integration surface — scaffold() emits the header on write and diffs
 * on augment. Those paths are exercised in the bench, not here.
 */

import { describe, expect, it } from "vitest";
import {
  computeDomHash,
  buildDomHashHeader,
  extractDomHashFromPom,
  prependDomHashHeader,
} from "../../src/discovery/domHash";
import type { PageSnapshot } from "../../src/discovery/mcpClient";

function makeSnapshot(tree: unknown, url = "https://example.com"): PageSnapshot {
  return {
    url,
    title: "Test",
    accessibilityTree: tree,
    domSnapshot: "<body></body>",
  };
}

describe("computeDomHash", () => {
  it("returns a lowercase 64-char hex sha256", () => {
    const hash = computeDomHash(makeSnapshot({ role: "form", children: [] }));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic for equivalent trees", () => {
    const a = computeDomHash(makeSnapshot({ a: 1, b: 2 }));
    const b = computeDomHash(makeSnapshot({ a: 1, b: 2 }));
    expect(a).toBe(b);
  });

  it("is deterministic regardless of key order (canonical stringify)", () => {
    const a = computeDomHash(makeSnapshot({ a: 1, b: 2 }));
    const b = computeDomHash(makeSnapshot({ b: 2, a: 1 }));
    expect(a).toBe(b);
  });

  it("changes when the tree changes", () => {
    const a = computeDomHash(makeSnapshot({ role: "form" }));
    const b = computeDomHash(makeSnapshot({ role: "button" }));
    expect(a).not.toBe(b);
  });

  it("only hashes the accessibility tree, not url or dom snapshot", () => {
    const a = computeDomHash(makeSnapshot({ role: "form" }, "https://a.com"));
    const b = computeDomHash(makeSnapshot({ role: "form" }, "https://b.com"));
    expect(a).toBe(b);
  });

  it("handles nested arrays and null values", () => {
    const hash = computeDomHash(
      makeSnapshot({
        children: [
          { role: "input", name: null },
          { role: "button", disabled: false },
        ],
      }),
    );
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("buildDomHashHeader / extractDomHashFromPom", () => {
  const hash = "a".repeat(64);
  const url = "https://saucedemo.com/";
  const at = new Date("2026-08-21T14:32:00Z");

  it("emits the @bdd2pw JSDoc block", () => {
    const header = buildDomHashHeader(hash, url, at);
    expect(header).toContain("/**");
    expect(header).toContain("@bdd2pw dom-hash " + hash);
    expect(header).toContain("@bdd2pw url " + url);
    expect(header).toContain("@bdd2pw generated 2026-08-21T14:32:00.000Z");
  });

  it("round-trips: extractDomHashFromPom(buildDomHashHeader(h)) === h", () => {
    const header = buildDomHashHeader(hash, url, at);
    expect(extractDomHashFromPom(header)).toBe(hash);
  });

  it("returns undefined for a POM without a hash header", () => {
    expect(extractDomHashFromPom('import { Page } from "playwright";')).toBeUndefined();
  });

  it("returns undefined for a stripped/hand-edited hash line", () => {
    const notReallyAHash = "/** @bdd2pw dom-hash hand_edited_not_a_hash */";
    expect(extractDomHashFromPom(notReallyAHash)).toBeUndefined();
  });
});

describe("prependDomHashHeader", () => {
  const hash = "b".repeat(64);
  const url = "https://saucedemo.com/";
  const header = buildDomHashHeader(hash, url, new Date("2026-08-21T00:00:00Z"));

  it("prepends the header above imports on first emit", () => {
    const pom = 'import { Page } from "@playwright/test";\n\nexport class LoginPage {}\n';
    const out = prependDomHashHeader(pom, header);
    expect(out.startsWith("/**")).toBe(true);
    expect(out).toContain('import { Page }');
    expect(extractDomHashFromPom(out)).toBe(hash);
  });

  it("is idempotent: repeated calls with the SAME header produce the same output", () => {
    const pom = 'import { Page } from "@playwright/test";\n';
    const once = prependDomHashHeader(pom, header);
    const twice = prependDomHashHeader(once, header);
    expect(twice).toBe(once);
  });

  it("replaces an old header with a new one instead of stacking", () => {
    const oldHeader = buildDomHashHeader("c".repeat(64), url, new Date("2026-08-01T00:00:00Z"));
    const pom = 'import { Page } from "@playwright/test";\n';
    const withOld = prependDomHashHeader(pom, oldHeader);
    const withNew = prependDomHashHeader(withOld, header);
    // New hash should be present, old should NOT.
    expect(extractDomHashFromPom(withNew)).toBe(hash);
    expect(withNew).not.toContain("c".repeat(64));
    // Exactly one header block (only one occurrence of "@bdd2pw dom-hash").
    expect((withNew.match(/@bdd2pw dom-hash/g) || []).length).toBe(1);
  });
});
