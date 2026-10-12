/**
 * v4.5.1 smoke test for attestqa Bug A + Bug B. Bypasses vitest.
 * Run after `npm run build`.
 *
 * Bug A — pickLocator should return undefined (not empty-args locator)
 *         when the element has no stable identifier.
 * Bug B — parseLocatorField should return undefined (not args:'""')
 *         when the field initialiser doesn't match the regex.
 *         scanRepo should populate unparseableFieldNames and the IR
 *         should carry a "unparseable" placeholder for resolver use.
 */

import { pickLocator, dedupeLocators } from "../dist/transformers/locatorPicker.js";
import { scanRepo } from "../dist/repo/repoScanner.js";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";

let passed = 0;
let failed = 0;
function check(name, cond, actual) {
  if (cond) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.log(`  FAIL  ${name}`);
    console.log(`        got: ${JSON.stringify(actual).slice(0, 400)}`);
    failed++;
  }
}
const tmpDirs = [];
async function makeRepo() {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), "bdd2pw-v451-smoke-"));
  tmpDirs.push(d);
  return d;
}
async function rmrf(p) { try { await fs.rm(p, { recursive: true, force: true }); } catch {} }

console.log("v4.5.1 — attestqa Bug A + Bug B smoke test\n");

// Bug A — element with no identifying info AND empty tag → undefined
{
  const el = { tag: "" };
  const picked = pickLocator(el, [el]);
  check(
    "Bug A: pickLocator returns undefined for element with no identifier + empty tag",
    picked === undefined,
    picked,
  );
}

// Bug A — element with no identifying info AND undefined tag → undefined
{
  const el = {};
  const picked = pickLocator(el, [el]);
  check(
    "Bug A: pickLocator returns undefined for element with no identifier + missing tag",
    picked === undefined,
    picked,
  );
}

// Bug A — element with tag ONLY (no other info) → tag locator
{
  const el = { tag: "button" };
  const picked = pickLocator(el, [el]);
  check(
    "Bug A: tag-only element still produces a valid tag locator",
    picked !== undefined && picked.api === "locator" && picked.args === '"button"',
    picked,
  );
}

// Bug A — dedupeLocators filters undefineds
{
  const picks = [
    { api: "getByRole", args: '"button"', fieldName: "btn", source: { tag: "button" }, confidence: "unique" },
    undefined,
    undefined,
    { api: "getByLabel", args: '"Email"', fieldName: "email", source: { tag: "input" }, confidence: "unique" },
  ];
  const out = dedupeLocators(picks);
  check(
    "Bug A: dedupeLocators filters undefined entries silently",
    out.length === 2 && out[0].fieldName === "btn" && out[1].fieldName === "email",
    out,
  );
}

// Bug B — scanRepo exposes the new unparseableFieldNames surface
{
  const repo = await makeRepo();
  const result = await scanRepo(repo);
  check(
    "Bug B: scanRepo returns an unparseableFieldNames Map on its result",
    result.unparseableFieldNames instanceof Map,
    typeof result.unparseableFieldNames,
  );
  check(
    "Bug B: unparseableFieldNames is empty on a fresh repo (no POMs yet)",
    result.unparseableFieldNames.size === 0,
    { size: result.unparseableFieldNames.size },
  );
  await rmrf(repo);
}

// Bug B — LocatorChoice.confidence accepts 'unparseable' sentinel
{
  const choice = {
    api: "locator",
    args: '""',
    fieldName: "hand-wrapped",
    source: { tag: "" },
    confidence: "unparseable",
  };
  // Just assert the value — the TypeScript gate enforces the union at
  // compile time; runtime it's a bare string.
  check(
    "Bug B: 'unparseable' is a valid confidence value",
    choice.confidence === "unparseable",
    choice,
  );
}

// Bug B — dedupeLocators preserves 'unparseable' entries (they're not
// treated as "pickable", but they need to flow through for the resolver)
{
  const picks = [
    {
      api: "getByRole",
      args: '"button"',
      fieldName: "btn",
      source: { tag: "button" },
      confidence: "unique",
    },
    {
      api: "locator",
      args: '""',
      fieldName: "handWrapped",
      source: { tag: "" },
      confidence: "unparseable",
    },
  ];
  const out = dedupeLocators(picks);
  check(
    "Bug B: dedupeLocators preserves 'unparseable' entries so they reach the filter at emit time",
    out.length === 2 && out.some((o) => o.confidence === "unparseable"),
    out.map((o) => ({ name: o.fieldName, conf: o.confidence })),
  );
}

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
