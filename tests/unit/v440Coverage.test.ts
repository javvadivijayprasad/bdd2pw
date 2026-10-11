/**
 * v4.4.0 Slice 2 — coverage analyzer acceptance tests.
 *
 * Four acceptance criteria from the brief:
 *
 *  1. On the fixture repo, every rule that demonstrably fired appears
 *     with a count ≥ 1, and a deliberately unused pack appears under
 *     dead rules.
 *  2. Promotion trail: a candidate rule from candidate-rules.jsonl
 *     that was added to the table and then fired is reported in all
 *     three states, in order.
 *  3. `coverage` and `quarantine-stats` agree on the counts they
 *     share (totals + promotions).
 *  4. Runs with no sidecars at all exit cleanly, saying which
 *     artefacts are missing and what produces them.
 */

import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { analyseCoverage } from "../../src/reports/coverage";
import { analyseQuarantineStats } from "../../src/reports/quarantineStats";
import { bindingsToMetaSteps } from "../../src/reports/metaSidecar";
import type { StepBinding } from "../../src/types";

const tmpDirs: string[] = [];
async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bdd2pw-v440cov-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()!;
    await fs.remove(dir).catch(() => {});
  }
});

async function writeSidecar(
  repo: string,
  specStem: string,
  scenarios: {
    name: string;
    tags?: string[];
    bindings: StepBinding[];
  }[],
) {
  const testsDir = path.join(repo, "tests");
  await fs.ensureDir(testsDir);
  const file = path.join(testsDir, specStem + ".spec.meta.json");
  await fs.writeJson(
    file,
    {
      version: "4.4.0-test",
      source: specStem + ".feature",
      scenarios: scenarios.map((s) => ({
        name: s.name,
        tags: s.tags,
        steps: bindingsToMetaSteps(s.bindings),
      })),
    },
    { spaces: 2 },
  );
  return file;
}

function ruleBinding(
  text: string,
  ruleId: string,
  overrides: {
    keyword?: string;
    pack?:
      | "banking"
      | "healthcare"
      | "insurance"
      | "retail"
      | "gov"
      | "education"
      | "telecom";
  } = {},
): StepBinding {
  return {
    step: { keyword: overrides.keyword ?? "When", text },
    pomCall: { page: "loginPage", method: "usernameInput.fill", args: ['"x"'] },
    provenance: {
      source: "rule",
      ruleId,
      pack: overrides.pack,
    },
  };
}

function llmBinding(text: string, cached = false): StepBinding {
  return {
    step: { keyword: "When", text },
    pomCall: { page: "loginPage", method: "usernameInput.fill", args: ['"y"'] },
    provenance: {
      source: "llm",
      llm: {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        cached,
        governance: "sanitised",
        at: "2026-09-25T12:00:00.000Z",
      },
    },
  };
}

describe("v4.4.0 Slice 2 — acceptance", () => {
  it("(1) rules that fired appear with count ≥ 1; unused pack shows in packs.dead", async () => {
    const repo = await makeRepo();
    await writeSidecar(repo, "login", [
      {
        name: "Fires two rules",
        bindings: [
          ruleBinding("Given I am on the login page", "rule-01", {
            keyword: "Given",
          }),
          ruleBinding("I enter my username", "rule-02"),
          ruleBinding("I confirm my SSN 123-45-6789", "domain-01", {
            pack: "banking",
          }),
        ],
      },
    ]);
    const { coverage } = await analyseCoverage({
      repo,
      version: "4.4.0",
      // Registry knows about 3 rules — 2 that fired, 1 that didn't —
      // plus a "healthcare" pack rule with nothing in the sidecar.
      registryRuleIds: [
        { ruleId: "domain-01", pack: "banking" },
        { ruleId: "domain-02", pack: "healthcare" }, // dead
        { ruleId: "rule-01" },
        { ruleId: "rule-02" },
        { ruleId: "rule-03" }, // dead
      ],
    });
    const ids = new Set(coverage.rules.hit.map((r) => r.ruleId));
    expect(ids.has("rule-01")).toBe(true);
    expect(ids.has("rule-02")).toBe(true);
    expect(ids.has("domain-01")).toBe(true);
    // Each fired rule counted ≥ 1.
    for (const r of coverage.rules.hit) expect(r.hitCount).toBeGreaterThan(0);
    // Dead rules include the ones that never appeared.
    const deadIds = new Set(coverage.rules.dead.map((r) => r.ruleId));
    expect(deadIds.has("rule-03")).toBe(true);
    expect(deadIds.has("domain-02")).toBe(true);
    // Dead packs: healthcare had a rule but nothing fired.
    expect(coverage.packs.dead).toContain("healthcare");
    // Live pack: banking had a hit.
    expect(coverage.packs.hit.banking?.hitCount).toBe(1);
    expect(coverage.packs.hit.banking?.ruleIdsFired).toContain("domain-01");
  });

  it("(2) promotion trail: a candidate step now covered by a rule appears in promotions.promoted", async () => {
    const repo = await makeRepo();
    // Round 1 — record the LLM binding in candidate-rules.jsonl.
    const artefactsDir = path.join(repo, "artefacts");
    await fs.ensureDir(artefactsDir);
    await fs.writeFile(
      path.join(artefactsDir, "candidate-rules.jsonl"),
      JSON.stringify({
        ts: "2026-09-20T00:00:00.000Z",
        scaffoldId: "sc1",
        stepText: "legacy phrasing that used to need LLM",
        stepKeyword: "When",
        binding: { step: { keyword: "When", text: "..." } },
        pomSignature: { className: "LoginPage", fieldNames: [], methodNames: [] },
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        fromCache: false,
      }) + "\n",
      "utf8",
    );
    // Round 2 — the current sidecar shows this same step now bound by
    // a rule. The promotion loop should close.
    await writeSidecar(repo, "legacy", [
      {
        name: "Rule caught up",
        bindings: [
          ruleBinding("legacy phrasing that used to need LLM", "rule-42"),
        ],
      },
    ]);
    const { coverage } = await analyseCoverage({
      repo,
      version: "4.4.0",
      registryRuleIds: [{ ruleId: "rule-42" }],
    });
    // Candidate was surveyed; step no longer @llm-generated; therefore promoted.
    expect(coverage.promotions.candidateStepsSurveyed).toBe(1);
    expect(coverage.promotions.promoted).toBe(1);
    expect(coverage.promotions.promotedStepTexts).toContain(
      "legacy phrasing that used to need LLM",
    );
    // And the "now firing" side of the trail is visible in the hit list.
    expect(coverage.rules.hit.find((r) => r.ruleId === "rule-42")?.hitCount).toBe(1);
  });

  it("(3) coverage and quarantine-stats agree on the shared counts (totals + promotions)", async () => {
    const repo = await makeRepo();
    await writeSidecar(repo, "mix", [
      {
        name: "S1",
        tags: ["@llm-generated"],
        bindings: [
          ruleBinding("Given here", "rule-01", { keyword: "Given" }),
          llmBinding("cached step", true),
          llmBinding("fresh step", false),
        ],
      },
      {
        name: "S2",
        bindings: [
          ruleBinding("first", "rule-01"),
          ruleBinding("second", "rule-02"),
        ],
      },
    ]);
    const { stats } = await analyseQuarantineStats({ repo, version: "4.4.0" });
    const { coverage } = await analyseCoverage({
      repo,
      version: "4.4.0",
      registryRuleIds: [{ ruleId: "rule-01" }, { ruleId: "rule-02" }],
    });
    // Shared totals must be identical, field by field.
    expect(coverage.totals).toEqual(stats.totals);
    // Shared promotions must be identical.
    expect(coverage.promotions).toEqual(stats.promotions);
  });

  it("(4) empty repo (no sidecars at all) exits cleanly and names the missing artefacts", async () => {
    const repo = await makeRepo();
    const { coverage } = await analyseCoverage({
      repo,
      version: "4.4.0",
      registryRuleIds: [{ ruleId: "rule-01" }],
    });
    expect(coverage.sidecars).toBe(0);
    expect(coverage.rules.hit).toEqual([]);
    // Every registry rule is dead in an empty repo.
    expect(coverage.rules.dead.map((r) => r.ruleId)).toContain("rule-01");
    // Missing-artefacts list surfaces at least the heal log and the
    // candidate-rules file so the user knows what to run.
    const missing = coverage.missingArtefacts.join(" | ");
    expect(missing).toContain("heal-events");
    expect(missing).toContain("candidate-rules");
  });

  it("(5) heal pressure sorts locators by heal count", async () => {
    const repo = await makeRepo();
    await writeSidecar(repo, "s", [
      { name: "any", bindings: [ruleBinding("x", "rule-01")] },
    ]);
    const artefactsDir = path.join(repo, "artefacts");
    await fs.ensureDir(artefactsDir);
    await fs.writeFile(
      path.join(artefactsDir, "heal-events.jsonl"),
      [
        { event: "heal_attempt", page: "LoginPage", name: "usernameInput" },
        { event: "healed", page: "LoginPage", name: "usernameInput" },
        { event: "healed", page: "LoginPage", name: "usernameInput" },
        { event: "heal_attempt", page: "LoginPage", name: "passwordInput" },
        { event: "register", page: "LoginPage", name: "signInButton" }, // ignored
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
    expect(coverage.healPressure[0].locatorKey).toBe("LoginPage.usernameInput");
    expect(coverage.healPressure[0].healCount).toBe(3);
    // register events don't contribute.
    const keys = coverage.healPressure.map((h) => h.locatorKey);
    expect(keys).not.toContain("LoginPage.signInButton");
  });
});
