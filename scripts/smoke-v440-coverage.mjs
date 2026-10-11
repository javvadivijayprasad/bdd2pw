/**
 * v4.4.0 Slice 2 smoke test for the coverage analyzer. Bypasses vitest
 * so it works in environments without rollup native binaries. Run
 * after `npm run build`.
 */

import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { analyseCoverage } from "../dist/reports/coverage.js";
import { analyseQuarantineStats } from "../dist/reports/quarantineStats.js";
import { bindingsToMetaSteps } from "../dist/reports/metaSidecar.js";

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
async function makeRepo() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "bdd2pw-v440cov-smoke-"));
}
async function rmrf(p) {
  try { await fs.rm(p, { recursive: true, force: true }); } catch {}
}
async function writeSidecar(repo, stem, scenarios) {
  const testsDir = path.join(repo, "tests");
  await fs.mkdir(testsDir, { recursive: true });
  const file = path.join(testsDir, stem + ".spec.meta.json");
  await fs.writeFile(
    file,
    JSON.stringify(
      {
        version: "4.4.0-smoke",
        source: stem + ".feature",
        scenarios: scenarios.map((s) => ({
          name: s.name,
          tags: s.tags,
          steps: bindingsToMetaSteps(s.bindings),
        })),
      },
      null,
      2,
    ),
    "utf8",
  );
}
const ruleBinding = (text, ruleId, pack) => ({
  step: { keyword: "When", text },
  pomCall: { page: "loginPage", method: "usernameInput.fill", args: ['"x"'] },
  provenance: { source: "rule", ruleId, pack },
});
const llmBinding = (text, cached = false) => ({
  step: { keyword: "When", text },
  pomCall: { page: "loginPage", method: "usernameInput.fill", args: ['"y"'] },
  provenance: {
    source: "llm",
    llm: {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      cached,
      governance: "sanitised",
      at: "2026-09-26T00:00:00.000Z",
    },
  },
});

console.log("v4.4.0 Slice 2 — coverage analyzer smoke test\n");

// (1) rule hits + dead pack
{
  const repo = await makeRepo();
  await writeSidecar(repo, "s", [
    {
      name: "any",
      bindings: [
        ruleBinding("a", "rule-01"),
        ruleBinding("b", "rule-01"),
        ruleBinding("c", "domain-01", "banking"),
      ],
    },
  ]);
  const { coverage } = await analyseCoverage({
    repo,
    version: "4.4.0",
    registryRuleIds: [
      { ruleId: "domain-01", pack: "banking" },
      { ruleId: "domain-02", pack: "healthcare" },
      { ruleId: "rule-01" },
      { ruleId: "rule-02" },
    ],
  });
  const rule01 = coverage.rules.hit.find((r) => r.ruleId === "rule-01");
  check(
    "(1) rule-01 fires twice; healthcare dead; banking live",
    rule01?.hitCount === 2 &&
      coverage.packs.dead.includes("healthcare") &&
      coverage.packs.hit.banking?.hitCount === 1 &&
      coverage.rules.dead.some((r) => r.ruleId === "rule-02"),
    { rule01, dead: coverage.rules.dead, packs: coverage.packs },
  );
  await rmrf(repo);
}

// (2) promotion trail: candidate now rule-bound
{
  const repo = await makeRepo();
  const artefactsDir = path.join(repo, "artefacts");
  await fs.mkdir(artefactsDir, { recursive: true });
  await fs.writeFile(
    path.join(artefactsDir, "candidate-rules.jsonl"),
    JSON.stringify({
      ts: "2026-09-20T00:00:00.000Z",
      scaffoldId: "s1",
      stepText: "was LLM, now rule",
      stepKeyword: "When",
      binding: { step: { keyword: "When", text: "..." } },
      pomSignature: { className: "P", fieldNames: [], methodNames: [] },
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      fromCache: false,
    }) + "\n",
    "utf8",
  );
  await writeSidecar(repo, "legacy", [
    { name: "n", bindings: [ruleBinding("was LLM, now rule", "rule-42")] },
  ]);
  const { coverage } = await analyseCoverage({
    repo,
    version: "4.4.0",
    registryRuleIds: [{ ruleId: "rule-42" }],
  });
  check(
    "(2) candidate step now rule-bound is reported as a promotion",
    coverage.promotions.candidateStepsSurveyed === 1 &&
      coverage.promotions.promoted === 1 &&
      coverage.promotions.promotedStepTexts.includes("was LLM, now rule"),
    coverage.promotions,
  );
  await rmrf(repo);
}

// (3) coverage.totals === quarantine-stats.totals on same repo
{
  const repo = await makeRepo();
  await writeSidecar(repo, "mix", [
    {
      name: "S1",
      tags: ["@llm-generated"],
      bindings: [
        ruleBinding("Given here", "rule-01"),
        llmBinding("cached", true),
        llmBinding("fresh", false),
      ],
    },
    { name: "S2", bindings: [ruleBinding("first", "rule-01"), ruleBinding("second", "rule-02")] },
  ]);
  const { stats } = await analyseQuarantineStats({ repo, version: "4.4.0" });
  const { coverage } = await analyseCoverage({
    repo,
    version: "4.4.0",
    registryRuleIds: [{ ruleId: "rule-01" }, { ruleId: "rule-02" }],
  });
  const totalsAgree =
    JSON.stringify(coverage.totals) === JSON.stringify(stats.totals);
  const promotionsAgree =
    JSON.stringify(coverage.promotions) === JSON.stringify(stats.promotions);
  check(
    "(3) totals + promotions agree with quarantine-stats on the same repo",
    totalsAgree && promotionsAgree,
    { totalsAgree, promotionsAgree, cov: coverage.totals, qs: stats.totals },
  );
  await rmrf(repo);
}

// (4) empty repo — clean exit + missing-artefacts list
{
  const repo = await makeRepo();
  const { coverage } = await analyseCoverage({
    repo,
    version: "4.4.0",
    registryRuleIds: [{ ruleId: "rule-01" }],
  });
  const missing = coverage.missingArtefacts.join(" | ");
  check(
    "(4) empty repo → clean report + missing-artefacts names heal + candidate-rules",
    coverage.sidecars === 0 &&
      coverage.rules.hit.length === 0 &&
      coverage.rules.dead.some((r) => r.ruleId === "rule-01") &&
      missing.includes("heal-events") &&
      missing.includes("candidate-rules"),
    { sidecars: coverage.sidecars, dead: coverage.rules.dead.length, missing },
  );
  await rmrf(repo);
}

// (5) heal pressure sort
{
  const repo = await makeRepo();
  await writeSidecar(repo, "s", [{ name: "n", bindings: [ruleBinding("x", "rule-01")] }]);
  const artefactsDir = path.join(repo, "artefacts");
  await fs.mkdir(artefactsDir, { recursive: true });
  await fs.writeFile(
    path.join(artefactsDir, "heal-events.jsonl"),
    [
      { event: "heal_attempt", page: "LP", name: "u" },
      { event: "healed", page: "LP", name: "u" },
      { event: "healed", page: "LP", name: "u" },
      { event: "heal_attempt", page: "LP", name: "p" },
      { event: "register", page: "LP", name: "b" },
    ]
      .map((e) => JSON.stringify(e))
      .join("\n") + "\n",
    "utf8",
  );
  const { coverage } = await analyseCoverage({
    repo,
    version: "4.4.0",
    registryRuleIds: [{ ruleId: "rule-01" }],
  });
  check(
    "(5) heal pressure sorted by count; register events ignored",
    coverage.healPressure[0]?.locatorKey === "LP.u" &&
      coverage.healPressure[0]?.healCount === 3 &&
      !coverage.healPressure.some((h) => h.locatorKey === "LP.b"),
    coverage.healPressure,
  );
  await rmrf(repo);
}

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
