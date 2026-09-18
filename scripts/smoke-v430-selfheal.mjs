/**
 * v4.3.0 smoke test for pw-self-heal scaffold emission. Bypasses vitest
 * so it works in environments without rollup native binaries. Run
 * after `npm run build`.
 */

import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { scaffoldProject } from "../dist/repo/projectScaffolder.js";

let passed = 0;
let failed = 0;
function check(name, condition, actual) {
  if (condition) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.log(`  FAIL  ${name}`);
    console.log(`        got: ${JSON.stringify(actual).slice(0, 300)}`);
    failed++;
  }
}
async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}
async function readJson(p) {
  return JSON.parse(await fs.readFile(p, "utf8"));
}
async function rmrf(p) {
  try { await fs.rm(p, { recursive: true, force: true }); } catch {}
}
async function makeRepo() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "bdd2pw-v430-smoke-"));
}

console.log("v4.3.0 — pw-self-heal scaffold smoke test\n");

// Default mode → tests/fixtures.ts written with hybrid mode
{
  const repo = await makeRepo();
  await scaffoldProject({ repoRoot: repo, baseUrl: "https://example.com", projectName: "demo", selfHealing: true });
  const p = path.join(repo, "tests", "fixtures.ts");
  const ex = await exists(p);
  const contents = ex ? await fs.readFile(p, "utf8") : "";
  check(
    "default mode writes tests/fixtures.ts with hybrid mode",
    ex && contents.includes('withSelfHealing(base, { mode: "hybrid" })') && contents.includes('@vijaypjavvadi/pw-self-heal'),
    contents.slice(0, 200),
  );
  await rmrf(repo);
}

// selfHealingMode: heuristic → mode is heuristic
{
  const repo = await makeRepo();
  await scaffoldProject({ repoRoot: repo, baseUrl: "https://example.com", selfHealing: true, selfHealingMode: "heuristic" });
  const contents = await fs.readFile(path.join(repo, "tests", "fixtures.ts"), "utf8");
  check(
    "selfHealingMode=heuristic emits heuristic in fixture",
    contents.includes('mode: "heuristic"') && !contents.includes('mode: "hybrid"'),
    contents.slice(0, 200),
  );
  await rmrf(repo);
}

// Re-emission idempotent + refreshes mode
{
  const repo = await makeRepo();
  await scaffoldProject({ repoRoot: repo, baseUrl: "https://example.com", selfHealing: true, selfHealingMode: "heuristic" });
  await scaffoldProject({ repoRoot: repo, baseUrl: "https://example.com", selfHealing: true, selfHealingMode: "hybrid" });
  const contents = await fs.readFile(path.join(repo, "tests", "fixtures.ts"), "utf8");
  check(
    "re-emitting with new mode overwrites fixture cleanly",
    contents.includes('mode: "hybrid"') && !contents.includes('mode: "heuristic"'),
    contents.slice(0, 200),
  );
  await rmrf(repo);
}

// .pwheal/.gitkeep placeholder
{
  const repo = await makeRepo();
  await scaffoldProject({ repoRoot: repo, baseUrl: "https://example.com", selfHealing: true });
  const gk = await exists(path.join(repo, ".pwheal", ".gitkeep"));
  check(".pwheal/.gitkeep placeholder created", gk === true, { gk });
  await rmrf(repo);
}

// package.json devDependencies: hybrid mode adds both
{
  const repo = await makeRepo();
  await scaffoldProject({ repoRoot: repo, baseUrl: "https://example.com", projectName: "demo", selfHealing: true, selfHealingMode: "hybrid" });
  const pkg = await readJson(path.join(repo, "package.json"));
  const psh = pkg.devDependencies?.["@vijaypjavvadi/pw-self-heal"];
  const onnx = pkg.devDependencies?.["onnxruntime-node"];
  check("hybrid mode adds pw-self-heal + onnxruntime-node to devDependencies", typeof psh === "string" && typeof onnx === "string", { psh, onnx });
  await rmrf(repo);
}

// package.json devDependencies: heuristic mode adds pw-self-heal only
{
  const repo = await makeRepo();
  await scaffoldProject({ repoRoot: repo, baseUrl: "https://example.com", projectName: "demo", selfHealing: true, selfHealingMode: "heuristic" });
  const pkg = await readJson(path.join(repo, "package.json"));
  const psh = pkg.devDependencies?.["@vijaypjavvadi/pw-self-heal"];
  const onnx = pkg.devDependencies?.["onnxruntime-node"];
  check("heuristic mode adds pw-self-heal but NOT onnxruntime-node", typeof psh === "string" && onnx === undefined, { psh, onnx });
  await rmrf(repo);
}

// Legacy mode: deprecation warning + no fixtures.ts
{
  const repo = await makeRepo();
  const result = await scaffoldProject({ repoRoot: repo, baseUrl: "https://example.com", selfHealing: true, legacyHealing: true });
  const warn = result.warnings.find(w => typeof w.message === "string" && w.message.includes("--legacy-healing"));
  const fixturesExists = await exists(path.join(repo, "tests", "fixtures.ts"));
  check("--legacy-healing emits deprecation warning and no fixtures.ts", warn !== undefined && warn.severity === "warn" && fixturesExists === false, { hasWarning: !!warn, fixturesExists });
  await rmrf(repo);
}

// selfHealing false: neither fixtures nor lib/heal.ts nor .pwheal
{
  const repo = await makeRepo();
  await scaffoldProject({ repoRoot: repo, baseUrl: "https://example.com", selfHealing: false });
  const noFixtures = !(await exists(path.join(repo, "tests", "fixtures.ts")));
  const noHeal = !(await exists(path.join(repo, "lib", "heal.ts")));
  const noPwheal = !(await exists(path.join(repo, ".pwheal")));
  check("selfHealing=false emits none of the healing scaffolds", noFixtures && noHeal && noPwheal, { noFixtures, noHeal, noPwheal });
  await rmrf(repo);
}

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
