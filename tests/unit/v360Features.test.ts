/**
 * v3.6.0 — rule-trace diagnostics + auto-rule-proposal tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { diagnoseStep } from "../../src/transformers/stepMatcher";
import {
  fingerprint,
  proposeRules,
  synthesiseRegex,
} from "../../src/llm/proposeRules";
import type { PageObjectIR, StepIR } from "../../src/types";

const EMPTY_POM: PageObjectIR = {
  className: "Page",
  filePath: "pages/page.page.ts",
  fields: [],
  methods: [{ name: "goto", params: [], body: "", origin: "generated" }],
  exists: false,
};

describe("v3.6.0 — diagnoseStep rule trace", () => {
  it("returns up to topN entries", () => {
    const step: StepIR = {
      keyword: "When",
      text: "I do something nobody has heard of",
    };
    const trace = diagnoseStep(step, EMPTY_POM, "page", 3);
    expect(trace.length).toBeLessThanOrEqual(3);
    expect(trace.length).toBeGreaterThan(0);
    for (const entry of trace) {
      expect(entry.ruleId).toMatch(/^(rule|domain)-\d+/);
      expect(typeof entry.patternSource).toBe("string");
      expect(typeof entry.matchedButDeclined).toBe("boolean");
      expect(typeof entry.noMatch).toBe("boolean");
    }
  });

  it("scores no-match rules by token overlap so URL-shaped steps surface URL rules first", () => {
    const step: StepIR = {
      keyword: "Then",
      text: "the URL ends with something weird",
    };
    const trace = diagnoseStep(step, EMPTY_POM, "page", 5);
    // At least one of the top-5 should mention URL in its pattern.
    const anyUrl = trace.some((t) =>
      /url|URL/i.test(t.patternSource),
    );
    expect(anyUrl).toBe(true);
  });
});

describe("v3.6.0 — fingerprint", () => {
  it("collapses quoted literals to empty quotes", () => {
    expect(fingerprint('I enter "alice" into the username field')).toBe(
      'i enter "" into the username field',
    );
    expect(fingerprint('I enter "bob" into the username field')).toBe(
      'i enter "" into the username field',
    );
  });

  it("collapses currency, numbers, dates", () => {
    expect(fingerprint("the balance is $1,234.56")).toBe(
      "the balance is <MONEY>",
    );
    expect(fingerprint("the heart rate is 72 bpm")).toBe(
      "the heart rate is <NUM> bpm",
    );
    expect(fingerprint("the appointment is on 2026-05-22")).toBe(
      "the appointment is on <DATE>",
    );
  });
});

describe("v3.6.0 — synthesiseRegex", () => {
  it("emits captures for token positions that vary", () => {
    const r = synthesiseRegex([
      'I enter "alice" into the username field',
      'I enter "bob" into the username field',
    ]);
    // Should anchor and capture the quoted differs.
    expect(r.startsWith("^")).toBe(true);
    expect(r.endsWith("$")).toBe(true);
    expect(r).toContain("(.+?)");
  });
});

describe("v3.6.0 — proposeRules end-to-end", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bdd2pw-propose-"));
  });
  afterEach(async () => {
    await fs.remove(tmpDir).catch(() => undefined);
  });

  it("clusters 3 similar entries into 1 proposal, ignores singletons", async () => {
    const jsonl = [
      // Cluster A — same shape, 3 different quoted values.
      {
        ts: "2026-05-01T00:00:00Z",
        scaffoldId: "s1",
        stepText: 'I enter "alice" in the username field',
        stepKeyword: "When",
        binding: { step: { keyword: "When", text: "I enter \"alice\" in the username field" } },
        pomSignature: { className: "P", fieldNames: [], methodNames: [] },
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        fromCache: false,
      },
      {
        ts: "2026-05-02T00:00:00Z",
        scaffoldId: "s2",
        stepText: 'I enter "bob" in the username field',
        stepKeyword: "When",
        binding: { step: { keyword: "When", text: "I enter \"bob\" in the username field" } },
        pomSignature: { className: "P", fieldNames: [], methodNames: [] },
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        fromCache: false,
      },
      {
        ts: "2026-05-03T00:00:00Z",
        scaffoldId: "s3",
        stepText: 'I enter "carol" in the username field',
        stepKeyword: "When",
        binding: { step: { keyword: "When", text: "I enter \"carol\" in the username field" } },
        pomSignature: { className: "P", fieldNames: [], methodNames: [] },
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        fromCache: false,
      },
      // Singleton — should NOT become a proposal.
      {
        ts: "2026-05-04T00:00:00Z",
        scaffoldId: "s4",
        stepText: "the user fires a unique snowflake step",
        stepKeyword: "Then",
        binding: { step: { keyword: "Then", text: "the user fires a unique snowflake step" } },
        pomSignature: { className: "P", fieldNames: [], methodNames: [] },
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        fromCache: false,
      },
    ];
    const jsonlPath = path.join(tmpDir, "candidate-rules.jsonl");
    await fs.writeFile(
      jsonlPath,
      jsonl.map((e) => JSON.stringify(e)).join("\n"),
      "utf8",
    );

    const result = await proposeRules({ inputPath: jsonlPath });
    expect(result.proposalsWritten).toBe(1);
    expect(result.totalCandidates).toBe(4);
    expect(result.clusters[0].size).toBe(3);

    const md = await fs.readFile(result.outputPath, "utf8");
    expect(md).toContain("Proposal 1 — cluster of 3");
    expect(md).toContain('i enter "" in the username field');
    expect(md).toContain("```json");
    // The singleton step text should NOT appear in any proposal block —
    // it only shows up in clusters with size >= minClusterSize.
    expect(md).not.toContain("unique snowflake");
  });

  it("emits a clear 'no proposals' message when every entry is a singleton", async () => {
    // Three step shapes that fingerprint to DIFFERENT structural keys.
    // Picked these specifically because numbers/dates/quoted literals
    // all collapse — so the differing parts have to be the actual
    // English words, not just numeric data.
    const distinctTexts = [
      "the user logs in successfully",
      "the cart is empty after checkout",
      "the search returns no results banner",
    ];
    const entries = distinctTexts.map((stepText, i) => ({
      ts: `2026-05-0${i + 1}T00:00:00Z`,
      scaffoldId: `s${i + 1}`,
      stepText,
      stepKeyword: "When",
      binding: { step: { keyword: "When", text: stepText } },
      pomSignature: { className: "P", fieldNames: [], methodNames: [] },
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      fromCache: false,
    }));
    const jsonlPath = path.join(tmpDir, "candidate-rules.jsonl");
    await fs.writeFile(
      jsonlPath,
      entries.map((e) => JSON.stringify(e)).join("\n"),
      "utf8",
    );
    const result = await proposeRules({ inputPath: jsonlPath });
    expect(result.proposalsWritten).toBe(0);
    const md = await fs.readFile(result.outputPath, "utf8");
    expect(md).toMatch(/No clusters of size >= 2/);
  });

  it("accepts a repo path and finds artefacts/candidate-rules.jsonl", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bdd2pw-repo-"));
    const jsonlPath = path.join(repoRoot, "artefacts", "candidate-rules.jsonl");
    await fs.ensureDir(path.dirname(jsonlPath));
    await fs.writeFile(jsonlPath, "", "utf8");
    const result = await proposeRules({ inputPath: repoRoot });
    expect(result.totalCandidates).toBe(0);
    expect(result.outputPath).toContain("propose-rules.md");
    await fs.remove(repoRoot);
  });
});
