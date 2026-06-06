/**
 * v3.10.0 — heal-stats aggregator tests.
 *
 * Pure-function tests against the in-memory `aggregate()` entry point
 * (no fs, no I/O) plus one end-to-end test that round-trips through
 * the real `analyseHealStats` file path.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { aggregate, analyseHealStats } from "../../src/reports/healStats";

describe("v3.10.0 — healStats aggregate()", () => {
  it("returns zeros for an empty event list", () => {
    const s = aggregate([], "<source>", 10);
    expect(s.totals.registrations).toBe(0);
    expect(s.totals.healAttempts).toBe(0);
    expect(s.totals.healed).toBe(0);
    expect(s.totals.healRate).toBe(0);
    expect(s.totals.uniqueFields).toBe(0);
    expect(s.totals.uniquePages).toBe(0);
    expect(s.topFailingFields).toEqual([]);
    expect(s.topErrors).toEqual([]);
    expect(s.topCandidates).toEqual([]);
    expect(s.retryLatencyMs).toEqual({ p50: 0, p95: 0, min: 0, max: 0 });
    expect(s.perScenario).toEqual([]);
  });

  it("aggregates a mixed-event sequence correctly", () => {
    const events = [
      // 1 register + 1 attempt + 1 heal — success.
      { ts: "2026-06-01T00:00:00.000Z", event: "register", page: "LoginPage", name: "submitButton" },
      {
        ts: "2026-06-01T00:00:01.000Z",
        event: "heal_attempt",
        page: "LoginPage",
        name: "submitButton",
        method: "click",
        original: "#old-btn",
        error: "Timeout 30000ms exceeded",
        scenario_name: "User logs in",
      },
      {
        ts: "2026-06-01T00:00:02.500Z",
        event: "healed",
        page: "LoginPage",
        name: "submitButton",
        method: "click",
        original: "#old-btn",
        healed: "[data-testid='submit']",
        confidence: 0.9,
        scenario_name: "User logs in",
      },
      // 1 attempt + 1 unavailable — failure.
      { ts: "2026-06-01T00:00:03.000Z", event: "register", page: "HomePage", name: "menuButton" },
      {
        ts: "2026-06-01T00:00:04.000Z",
        event: "heal_attempt",
        page: "HomePage",
        name: "menuButton",
        method: "click",
        original: ".menu",
        error: "Timeout 30000ms exceeded",
        scenario_name: "User opens menu",
      },
      {
        ts: "2026-06-01T00:00:05.000Z",
        event: "heal_unavailable",
        page: "HomePage",
        name: "menuButton",
        method: "click",
        original: ".menu",
        error: "no candidate returned",
      },
      // Second register + heal of submitButton (same candidate reused).
      { ts: "2026-06-01T00:00:06.000Z", event: "register", page: "LoginPage", name: "submitButton" },
      {
        ts: "2026-06-01T00:00:07.000Z",
        event: "heal_attempt",
        page: "LoginPage",
        name: "submitButton",
        method: "click",
        original: "#old-btn",
        error: "Element not found",
        scenario_name: "User logs in",
      },
      {
        ts: "2026-06-01T00:00:08.000Z",
        event: "healed",
        page: "LoginPage",
        name: "submitButton",
        method: "click",
        original: "#old-btn",
        healed: "[data-testid='submit']",
        confidence: 0.85,
        scenario_name: "User logs in",
      },
    ] as any[];

    const s = aggregate(events, "<source>", 10);

    expect(s.totals.registrations).toBe(3);
    expect(s.totals.healAttempts).toBe(3);
    expect(s.totals.healed).toBe(2);
    expect(s.totals.healUnavailable).toBe(1);
    expect(s.totals.healRate).toBeCloseTo(2 / 3, 4);
    expect(s.totals.uniqueFields).toBe(2);
    expect(s.totals.uniquePages).toBe(2);

    // Top failing field — submitButton has 2 attempts (more than menuButton's 1).
    expect(s.topFailingFields[0]).toEqual({
      page: "LoginPage",
      name: "submitButton",
      attempts: 2,
      healed: 2,
    });
    expect(s.topFailingFields[1].name).toBe("menuButton");

    // Top error pattern — "Timeout ... exceeded" appeared in both real
    // failures (submit attempt 1 + menu attempt). truncateError collapses
    // them to the same bucket.
    expect(s.topErrors[0].count).toBe(2);

    // Top candidate — [data-testid='submit'] promoted twice with avg
    // confidence (0.9 + 0.85) / 2 = 0.875.
    expect(s.topCandidates[0]).toEqual({
      selector: "[data-testid='submit']",
      promotions: 2,
      averageConfidence: (0.9 + 0.85) / 2,
    });

    // Retry latency — submitButton's two heals took 1500ms and 1000ms.
    // p50 of [1000, 1500] sorted = idx ceil(2*0.5)-1 = 0 → 1000.
    // p95 = idx ceil(2*0.95)-1 = 1 → 1500.
    expect(s.retryLatencyMs.min).toBe(1000);
    expect(s.retryLatencyMs.max).toBe(1500);
    expect(s.retryLatencyMs.p50).toBe(1000);
    expect(s.retryLatencyMs.p95).toBe(1500);

    // Per-scenario stats.
    const loginScenario = s.perScenario.find((x) => x.scenario === "User logs in");
    expect(loginScenario).toEqual({ scenario: "User logs in", attempts: 2, healed: 2 });
  });

  it("respects topN", () => {
    // Generate 5 distinct failing fields.
    const events = [];
    for (let i = 0; i < 5; i++) {
      events.push({
        ts: `2026-06-01T00:00:0${i}.000Z`,
        event: "heal_attempt",
        page: "P",
        name: `field${i}`,
        method: "click",
        error: "boom",
      });
    }
    const top3 = aggregate(events as any[], "<source>", 3);
    expect(top3.topFailingFields).toHaveLength(3);
  });
});

describe("v3.10.0 — analyseHealStats end-to-end", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bdd2pw-heal-"));
  });
  afterEach(async () => {
    await fs.remove(tmpDir).catch(() => undefined);
  });

  it("reads jsonl, writes heal-stats.json, returns total events", async () => {
    const jsonlPath = path.join(tmpDir, "heal-events.jsonl");
    const events = [
      { ts: "2026-06-01T00:00:00.000Z", event: "register", page: "P", name: "f" },
      { ts: "2026-06-01T00:00:01.000Z", event: "heal_attempt", page: "P", name: "f", method: "click", error: "x" },
      { ts: "2026-06-01T00:00:02.000Z", event: "healed", page: "P", name: "f", method: "click", original: "old", healed: "new", confidence: 0.9 },
    ];
    await fs.writeFile(
      jsonlPath,
      events.map((e) => JSON.stringify(e)).join("\n"),
      "utf8",
    );
    const result = await analyseHealStats({ inputPath: jsonlPath });
    expect(result.totalEvents).toBe(3);
    expect(result.outputPath).toContain("heal-stats.json");
    const written = JSON.parse(await fs.readFile(result.outputPath, "utf8"));
    expect(written.totals.healAttempts).toBe(1);
    expect(written.totals.healed).toBe(1);
    expect(written.totals.healRate).toBe(1);
    expect(written.version).toBe("3.10.0");
  });

  it("treats a missing events file as zero-event summary, not an error", async () => {
    // Point at a directory that has no heal-events.jsonl at all.
    const result = await analyseHealStats({ inputPath: tmpDir });
    expect(result.totalEvents).toBe(0);
    const written = JSON.parse(await fs.readFile(result.outputPath, "utf8"));
    expect(written.totals.healAttempts).toBe(0);
  });

  it("accepts a repo path and finds artefacts/heal-events.jsonl", async () => {
    const jsonlPath = path.join(tmpDir, "artefacts", "heal-events.jsonl");
    await fs.ensureDir(path.dirname(jsonlPath));
    await fs.writeFile(
      jsonlPath,
      JSON.stringify({
        ts: "2026-06-01T00:00:00.000Z",
        event: "register",
        page: "P",
        name: "f",
      }),
      "utf8",
    );
    const result = await analyseHealStats({ inputPath: tmpDir });
    expect(result.totalEvents).toBe(1);
    expect(result.outputPath).toContain("heal-stats.json");
  });
});
