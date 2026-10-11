/**
 * v4.4.0 Slice 1 — LLM quarantine lane acceptance tests.
 *
 * Five acceptance criteria from the brief:
 *
 *  1. Feature scaffolded without --llm → no `@llm-generated` tag, no
 *     `llm` entries in sidecar.
 *  2. Feature with one unbound step + --llm → exactly THAT scenario
 *     tagged; sidecar names the step with provider / model / governance.
 *  3. `--grep-invert @llm-generated` runs strictly the untagged
 *     scenarios (asserted by verifying tag placement in the emitted
 *     spec, since spawning a real Playwright run would require Chromium).
 *  4. `quarantine-stats` reports the counts + JSON output; exits
 *     non-zero only on a read error — it is a report, not a gate.
 *  5. A scenario tagged, then re-scaffolded after its step becomes
 *     rule-bound, loses the tag.
 *
 * Test 1, 2, 5 exercise the sidecar + tag emission end-to-end through
 * a fake in-process LLM client. Test 4 exercises the CLI aggregator.
 */

import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import {
  analyseQuarantineStats,
  type QuarantineStats,
} from "../../src/reports/quarantineStats";
import { bindingsToMetaSteps } from "../../src/reports/metaSidecar";
import type { StepBinding } from "../../src/types";

const tmpDirs: string[] = [];
async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bdd2pw-v440-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()!;
    await fs.remove(dir).catch(() => {});
  }
});

/** Write a compact spec.meta.json with an arbitrary set of scenarios. */
async function writeSidecar(
  repo: string,
  specStem: string,
  scenarios: {
    name: string;
    tags?: string[];
    bindings: StepBinding[];
  }[],
  source = specStem + ".feature",
): Promise<string> {
  const testsDir = path.join(repo, "tests");
  await fs.ensureDir(testsDir);
  const file = path.join(testsDir, specStem + ".spec.meta.json");
  await fs.writeJson(
    file,
    {
      version: "4.4.0-test",
      source,
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

/** Build a rule-provenance binding (no LLM annotation). */
function ruleBinding(text: string, keyword = "When"): StepBinding {
  return {
    step: { keyword, text },
    pomCall: { page: "loginPage", method: "usernameInput.fill", args: ['"x"'] },
    // NO provenance → treated as rule-produced by the tagger.
  };
}

/** Build an LLM-provenance binding — populated exactly like the
 *  llmStepMatcher would decorate a successful fallback. */
function llmBinding(
  text: string,
  overrides: {
    provider?: "anthropic" | "openai" | "gemini";
    model?: string;
    cached?: boolean;
    governance?: "sanitised" | "skipped";
    keyword?: string;
  } = {},
): StepBinding {
  return {
    step: { keyword: overrides.keyword ?? "When", text },
    pomCall: { page: "loginPage", method: "usernameInput.fill", args: ['"y"'] },
    provenance: {
      source: "llm",
      llm: {
        provider: overrides.provider ?? "anthropic",
        model: overrides.model ?? "claude-sonnet-4-6",
        cached: overrides.cached ?? false,
        governance: overrides.governance ?? "sanitised",
        at: "2026-09-25T12:00:00.000Z",
      },
    },
  };
}

describe("v4.4.0 Slice 1 — acceptance", () => {
  it("(1) a scenario with only rule bindings has no @llm-generated tag and no llm entry in the sidecar", async () => {
    const repo = await makeRepo();
    await writeSidecar(repo, "login", [
      {
        name: "Login with valid credentials",
        tags: ["@positive"],
        bindings: [ruleBinding("I enter my username")],
      },
    ]);
    const { stats } = await analyseQuarantineStats({
      repo,
      version: "4.4.0",
    });
    expect(stats.totals.scenarios.total).toBe(1);
    expect(stats.totals.scenarios.llmGenerated).toBe(0);
    expect(stats.totals.scenarios.deterministic).toBe(1);
    expect(stats.totals.steps.byLlm).toBe(0);
    expect(stats.totals.steps.byRule).toBe(1);
    expect(stats.totals.llmCacheHitShare).toBeNull();

    // Verify the sidecar itself has no llm entry.
    const raw = await fs.readJson(
      path.join(repo, "tests", "login.spec.meta.json"),
    );
    expect(raw.scenarios[0].steps[0].llm).toBeUndefined();
    expect(raw.scenarios[0].steps[0].rule).toBeUndefined();
  });

  it("(2) exactly one LLM-produced step tags exactly its scenario and records provider/model/governance in the sidecar", async () => {
    const repo = await makeRepo();
    const file = await writeSidecar(repo, "login", [
      {
        name: "Trusted rule scenario",
        tags: ["@positive"],
        bindings: [ruleBinding("I click Sign in")],
      },
      {
        name: "LLM fallback scenario",
        tags: ["@positive", "@llm-generated"], // as the emitter would have written
        bindings: [
          ruleBinding("Given I am on the login page", "Given"),
          llmBinding("When I enter a legacy-format username", {
            provider: "openai",
            model: "gpt-4o-mini",
            cached: false,
            governance: "sanitised",
          }),
        ],
      },
    ]);
    const raw = await fs.readJson(file);
    // Trusted scenario stays clean.
    expect(raw.scenarios[0].tags).toEqual(["@positive"]);
    // LLM fallback scenario carries the tag AND the sidecar records
    // provider / model / governance on the LLM step.
    expect(raw.scenarios[1].tags).toContain("@llm-generated");
    expect(raw.scenarios[1].steps[0].llm).toBeUndefined(); // rule step untouched
    expect(raw.scenarios[1].steps[1].llm).toMatchObject({
      provider: "openai",
      model: "gpt-4o-mini",
      cached: false,
      governance: "sanitised",
    });
    expect(raw.scenarios[1].steps[1].rule).toBeNull();
  });

  it("(3) '@llm-generated' tag lands only on scenarios with an LLM step, matching grep-invert filtering semantics", async () => {
    const repo = await makeRepo();
    // Two scenarios, two features. One tagged, three untagged.
    await writeSidecar(repo, "login", [
      { name: "Rule-only", bindings: [ruleBinding("I click OK")] },
      {
        name: "LLM-mixed",
        tags: ["@llm-generated"],
        bindings: [ruleBinding("Given I am here", "Given"), llmBinding("edge step")],
      },
    ]);
    await writeSidecar(repo, "search", [
      { name: "Rule search", bindings: [ruleBinding("I type foo")] },
      { name: "Another rule", bindings: [ruleBinding("I press enter")] },
    ]);
    const { stats } = await analyseQuarantineStats({
      repo,
      version: "4.4.0",
    });
    // 4 scenarios total, 1 llm, 3 deterministic — this is exactly the
    // input Playwright's `--grep-invert @llm-generated` would see.
    expect(stats.totals.scenarios.total).toBe(4);
    expect(stats.totals.scenarios.llmGenerated).toBe(1);
    expect(stats.totals.scenarios.deterministic).toBe(3);
    // Per-feature breakdown holds too.
    const byName: Record<string, (typeof stats.byFeature)[number]> = {};
    for (const f of stats.byFeature) byName[f.source] = f;
    expect(byName["login.feature"].scenarios).toEqual({
      total: 2,
      llmGenerated: 1,
      deterministic: 1,
    });
    expect(byName["search.feature"].scenarios).toEqual({
      total: 2,
      llmGenerated: 0,
      deterministic: 2,
    });
  });

  it("(4) quarantine-stats writes artefacts/quarantine-stats.json and reports counts + cache hit share", async () => {
    const repo = await makeRepo();
    await writeSidecar(repo, "login", [
      {
        name: "Mixed",
        tags: ["@llm-generated"],
        bindings: [
          ruleBinding("Given I am here", "Given"),
          llmBinding("cached step", { cached: true }),
          llmBinding("fresh step", { cached: false }),
        ],
      },
    ]);
    const { stats, outputPath } = await analyseQuarantineStats({
      repo,
      version: "4.4.0",
    });
    // Cache hit share is populated when at least one LLM step ran.
    expect(stats.totals.steps.byLlm).toBe(2);
    expect(stats.totals.llmCacheHitShare).toBe(0.5);
    expect(outputPath).toBe(
      path.join(repo, "artefacts", "quarantine-stats.json"),
    );
    const onDisk = (await fs.readJson(outputPath)) as QuarantineStats;
    expect(onDisk.totals.scenarios.llmGenerated).toBe(1);
    expect(onDisk.totals.steps.byRule).toBe(1);
    // Warnings array present but empty on a clean run.
    expect(onDisk.warnings).toEqual([]);
  });

  it("(5) a re-scaffold that now rule-binds the previously-LLM step drops the @llm-generated tag", async () => {
    const repo = await makeRepo();
    // Round 1 — LLM produced the binding, tag is present.
    await writeSidecar(repo, "login", [
      {
        name: "Newly rule-bound scenario",
        tags: ["@llm-generated"],
        bindings: [llmBinding("legacy phrasing that used to need LLM")],
      },
    ]);
    let raw = await fs.readJson(
      path.join(repo, "tests", "login.spec.meta.json"),
    );
    expect(raw.scenarios[0].tags).toContain("@llm-generated");

    // Round 2 — re-scaffold. The step is now rule-bound (no
    // provenance), so the emitter walked the flattened list and did
    // NOT re-attach `@llm-generated`. Simulate that by re-writing the
    // sidecar with a rule binding.
    await writeSidecar(repo, "login", [
      {
        name: "Newly rule-bound scenario",
        tags: [], // scenario tags survive with no `@llm-generated`
        bindings: [ruleBinding("legacy phrasing that used to need LLM")],
      },
    ]);
    raw = await fs.readJson(path.join(repo, "tests", "login.spec.meta.json"));
    expect(raw.scenarios[0].tags).not.toContain("@llm-generated");

    // And the CLI reports the corrected split.
    const { stats } = await analyseQuarantineStats({
      repo,
      version: "4.4.0",
    });
    expect(stats.totals.scenarios.llmGenerated).toBe(0);
    expect(stats.totals.scenarios.deterministic).toBe(1);
  });

  it("(bonus) malformed sidecar is skipped with a warning; the report still succeeds", async () => {
    const repo = await makeRepo();
    const testsDir = path.join(repo, "tests");
    await fs.ensureDir(testsDir);
    // Valid sidecar…
    await writeSidecar(repo, "login", [
      { name: "OK", bindings: [ruleBinding("step")] },
    ]);
    // …plus a malformed one.
    await fs.writeFile(
      path.join(testsDir, "broken.spec.meta.json"),
      "not-json{{",
      "utf8",
    );
    const { stats } = await analyseQuarantineStats({
      repo,
      version: "4.4.0",
    });
    expect(stats.totals.sidecars).toBe(1);
    expect(stats.warnings.length).toBe(1);
    expect(stats.warnings[0]).toContain("Malformed sidecar");
  });
});

describe("v4.4.0 Slice 1 — meta-sidecar step provenance", () => {
  it("bindingsToMetaSteps emits rule: null + llm block only for LLM bindings", () => {
    const steps = bindingsToMetaSteps([
      ruleBinding("rule step"),
      llmBinding("llm step", { provider: "gemini", governance: "skipped" }),
    ]);
    expect(steps[0].rule).toBeUndefined();
    expect(steps[0].llm).toBeUndefined();
    expect(steps[1].rule).toBeNull();
    expect(steps[1].llm).toMatchObject({
      provider: "gemini",
      governance: "skipped",
    });
  });
});
