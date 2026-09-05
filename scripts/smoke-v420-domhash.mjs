/**
 * v4.2.0 smoke test for DOM-hash utilities. Runs without vitest so it
 * works in environments where rollup's platform-specific binaries
 * aren't installed. Run after `npm run build`.
 */

import {
  computeDomHash,
  buildDomHashHeader,
  extractDomHashFromPom,
  prependDomHashHeader,
} from "../dist/discovery/domHash.js";

let passed = 0;
let failed = 0;
function check(name, condition, actual) {
  if (condition) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.log(`  FAIL  ${name}`);
    console.log(`        got: ${JSON.stringify(actual)}`);
    failed++;
  }
}

console.log("v4.2.0 — DOM-hash utilities smoke test\n");

const makeSnap = (tree, url = "https://example.com") => ({
  url,
  title: "Test",
  accessibilityTree: tree,
  domSnapshot: "<body></body>",
});

// computeDomHash: 64-char hex
{
  const h = computeDomHash(makeSnap({ role: "form" }));
  check("computeDomHash returns 64-char lowercase hex", /^[a-f0-9]{64}$/.test(h), h);
}

// computeDomHash: deterministic
{
  const a = computeDomHash(makeSnap({ a: 1, b: 2 }));
  const b = computeDomHash(makeSnap({ a: 1, b: 2 }));
  check("computeDomHash deterministic for equivalent trees", a === b, { a, b });
}

// computeDomHash: canonical key order
{
  const a = computeDomHash(makeSnap({ a: 1, b: 2 }));
  const b = computeDomHash(makeSnap({ b: 2, a: 1 }));
  check("computeDomHash: key order does not affect hash (canonical)", a === b, { a, b });
}

// computeDomHash: different trees → different hashes
{
  const a = computeDomHash(makeSnap({ role: "form" }));
  const b = computeDomHash(makeSnap({ role: "button" }));
  check("computeDomHash: different trees produce different hashes", a !== b, { a, b });
}

// computeDomHash: url change alone doesn't affect hash
{
  const a = computeDomHash(makeSnap({ role: "form" }, "https://a.com"));
  const b = computeDomHash(makeSnap({ role: "form" }, "https://b.com"));
  check("computeDomHash: url change alone does not affect hash", a === b, { a, b });
}

// buildDomHashHeader: contains all three tags
{
  const hash = "a".repeat(64);
  const header = buildDomHashHeader(hash, "https://saucedemo.com/", new Date("2026-08-21T14:32:00Z"));
  const ok = header.includes("@bdd2pw dom-hash " + hash) &&
             header.includes("@bdd2pw url https://saucedemo.com/") &&
             header.includes("@bdd2pw generated 2026-08-21T14:32:00.000Z");
  check("buildDomHashHeader: contains @bdd2pw dom-hash, url, generated tags", ok, header);
}

// round-trip extract
{
  const hash = "a".repeat(64);
  const header = buildDomHashHeader(hash, "https://x", new Date());
  const extracted = extractDomHashFromPom(header);
  check("extractDomHashFromPom round-trips the hash", extracted === hash, extracted);
}

// extract from POM without header returns undefined
{
  const extracted = extractDomHashFromPom('import { Page } from "playwright";');
  check("extractDomHashFromPom returns undefined for POM without header", extracted === undefined, extracted);
}

// prependDomHashHeader: first-emit places header above imports
{
  const hash = "b".repeat(64);
  const header = buildDomHashHeader(hash, "https://x", new Date());
  const pom = 'import { Page } from "@playwright/test";\n\nexport class LoginPage {}\n';
  const out = prependDomHashHeader(pom, header);
  const ok = out.startsWith("/**") && out.includes("import { Page }") && extractDomHashFromPom(out) === hash;
  check("prependDomHashHeader: header lands above imports on first emit", ok, out.slice(0, 200));
}

// prependDomHashHeader: idempotent (same header, no duplication)
{
  const hash = "c".repeat(64);
  const header = buildDomHashHeader(hash, "https://x", new Date("2026-08-21T00:00:00Z"));
  const pom = 'import { Page } from "@playwright/test";\n';
  const once = prependDomHashHeader(pom, header);
  const twice = prependDomHashHeader(once, header);
  check("prependDomHashHeader: idempotent (same header twice → same output)", once === twice, { once, twice });
}

// prependDomHashHeader: replaces old header with new (no stacking)
{
  const oldHash = "d".repeat(64);
  const newHash = "e".repeat(64);
  const oldHeader = buildDomHashHeader(oldHash, "https://x", new Date("2026-08-01T00:00:00Z"));
  const newHeader = buildDomHashHeader(newHash, "https://x", new Date("2026-08-21T00:00:00Z"));
  const pom = 'import { Page } from "@playwright/test";\n';
  const withOld = prependDomHashHeader(pom, oldHeader);
  const withNew = prependDomHashHeader(withOld, newHeader);
  const ok = extractDomHashFromPom(withNew) === newHash &&
             !withNew.includes(oldHash) &&
             (withNew.match(/@bdd2pw dom-hash/g) || []).length === 1;
  check("prependDomHashHeader: replaces old header, doesn't stack", ok, withNew.slice(0, 300));
}

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
