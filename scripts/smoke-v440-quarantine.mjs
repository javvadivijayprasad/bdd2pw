/**
 * v4.4.0 Slice 1 smoke test for the quarantine-stats aggregator +
 * meta-sidecar provenance passthrough. Bypasses vitest so it works in
 * environments without rollup native binaries.
 * Run after `npm run build`.
 */

import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { analyseQuarantineStats } from "../dist/reports/quarantineStats.js";
import { bindingsToMetaSteps } from "../dist/reports/metaSidecar.js";

let passed = 0;
let failed = 0;
function check(name, condition, actual) {
  if (condition) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.log(`  FAIL  ${name}`);
    console.log(`        got: ${JSON.stringify(actual).slice(0, 400)}`);
    failed++;
  }
}
async function makeRepo() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "bdd2pw-v440-smoke-"));
}
async function rmrf(p) {
  try { await fs.rm(p, { recursive: true, force: true }); } catch {}
}
async function writeSidecar(repo, specStem, scenarios) {
  const testsDir = path.join(repo, "tests");
  await fs.mkdir(testsDir, { recursive: true });
  const file = path.join(testsDir, specStem + ".spec.meta.json");
  const contents = {
    version: "4.4.0-smoke",
    source: specStem + ".feature",
    scenarios: scenarios.map((s) => ({
      name: s.name,
      tags: s.tags,
      steps: bindingsToMetaSteps(s.bindings),
    })),
  };
  await fs.writeFile(file, JSON.stringify(contents, null, 2), "utf8");
  return file;
}
const ruleBinding = (text, keyword = "When") => ({
  step: { keyword, text },
  pomCall: { page: "loginPage", method: "usernameInput.fill", args: ['"x"'] },
});
const llmBinding = (text, o = {}) => ({
  step: { keyword: o.keyword ?? "When", text },
  pomCall: { page: "loginPage", method: "usernameInput.fill", args: ['"y"'] },
  provenance: {
    source: "llm",
    llm: {
      provider: o.provider ?? "anthropic",
      model: o.model ?? "claude-sonnet-4-6",
      cached: o.cached ?? false,
      governance: o.governance ?? "sanitised",
      at: "2026-09-25T12:00:00.000Z",
    },
  },
});

console.log("v4.4.0 Slice 1 — quarantine-stats + sidecar provenance smoke test\n");

// (1) rule-only scenario → no LLM anything
{
  const repo = await makeRepo();
  await writeSidecar(repo, "login", [
    { name: "Rule scenario", bindings: [ruleBinding("I click OK")] },
  ]);
  const { stats } = await analyseQuarantineStats({ repo, version: "4.4.0" });
  check(
    "(1) rule-only scenario reports 0 llmGenerated + null cache share",
    stats.totals.scenarios.llmGenerated === 0 &&
      stats.totals.scenarios.deterministic === 1 &&
      stats.totals.steps.byLlm === 0 &&
      stats.totals.llmCacheHitShare === null,
    stats.totals,
  );
  await rmrf(repo);
}

// (2) one LLM binding → provider/model/governance visible in sidecar
{
  const repo = await makeRepo();
  const file = await writeSidecar(repo, "login", [
    {
      name: "LLM fallback",
      tags: ["@llm-generated"],
      bindings: [llmBinding("edge step", { provider: "openai", model: "gpt-4o-mini" })],
    },
  ]);
  const raw = JSON.parse(await fs.readFile(file, "utf8"));
  const step = raw.scenarios[0].steps[0];
  check(
    "(2) sidecar records llm.provider, llm.model, llm.governance, rule=null",
    step.rule === null &&
      step.llm?.provider === "openai" &&
      step.llm?.model === "gpt-4o-mini" &&
      step.llm?.governance === "sanitised",
    step,
  );
  await rmrf(repo);
}

// (3) grep-invert semantics: split counted correctly across features
{
  const repo = await makeRepo();
  await writeSidecar(repo, "login", [
    { name: "Rule-only", bindings: [ruleBinding("click")] },
    { name: "LLM-mixed", tags: ["@llm-generated"], bindings: [ruleBinding("Given here", "Given"), llmBinding("edge")] },
  ]);
  await writeSidecar(repo, "search", [
    { name: "Rule search", bindings: [ruleBinding("type foo")] },
    { name: "Another rule", bindings: [ruleBinding("press enter")] },
  ]);
  const { stats } = await analyseQuarantineStats({ repo, version: "4.4.0" });
  check(
    "(3) two features, 4 scenarios → 1 llmGenerated, 3 deterministic",
    stats.totals.scenarios.total === 4 &&
      stats.totals.scenarios.llmGenerated === 1 &&
      stats.totals.scenarios.deterministic === 3,
    stats.totals.scenarios,
  );
  await rmrf(repo);
}

// (4) cache hit share
{
  const repo = await makeRepo();
  await writeSidecar(repo, "login", [
    {
      name: "Mixed",
      tags: ["@llm-generated"],
      bindings: [
        ruleBinding("Given here", "Given"),
        llmBinding("cached", { cached: true }),
        llmBinding("fresh",  { cached: false }),
      ],
    },
  ]);
  const { stats, outputPath } = await analyseQuarantineStats({ repo, version: "4.4.0" });
  check(
    "(4) 2 llm steps → cache hit share = 0.5; JSON written to artefacts/",
    stats.totals.steps.byLlm === 2 &&
      stats.totals.llmCacheHitShare === 0.5 &&
      outputPath.endsWith("quarantine-stats.json"),
    { steps: stats.totals.steps, share: stats.totals.llmCacheHitShare, outputPath },
  );
  await rmrf(repo);
}

// (5) re-scaffold — tag drops when step becomes rule-bound
{
  const repo = await makeRepo();
  await writeSidecar(repo, "login", [
    { name: "Sc", tags: ["@llm-generated"], bindings: [llmBinding("legacy")] },
  ]);
  await writeSidecar(repo, "login", [
    { name: "Sc", tags: [], bindings: [ruleBinding("legacy")] },
  ]);
  const raw = JSON.parse(await fs.readFile(path.join(repo, "tests", "login.spec.meta.json"), "utf8"));
  const { stats } = await analyseQuarantineStats({ repo, version: "4.4.0" });
  check(
    "(5) re-scaffold with rule binding drops @llm-generated tag",
    !raw.scenarios[0].tags.includes("@llm-generated") &&
      stats.totals.scenarios.llmGenerated === 0,
    { tags: raw.scenarios[0].tags, llmGen: stats.totals.scenarios.llmGenerated },
  );
  await rmrf(repo);
}

// (bonus) malformed sidecar → warning, no crash
{
  const repo = await makeRepo();
  await writeSidecar(repo, "ok", [
    { name: "ok", bindings: [ruleBinding("hi")] },
  ]);
  const testsDir = path.join(repo, "tests");
  await fs.writeFile(path.join(testsDir, "broken.spec.meta.json"), "not-json{{", "utf8");
  const { stats } = await analyseQuarantineStats({ repo, version: "4.4.0" });
  check(
    "(bonus) malformed sidecar → warning, valid sidecar still counted",
    stats.totals.sidecars === 1 && stats.warnings.length === 1 && stats.warnings[0].includes("Malformed"),
    { warnings: stats.warnings, sidecars: stats.totals.sidecars },
  );
  await rmrf(repo);
}

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
