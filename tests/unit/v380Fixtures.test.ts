/**
 * v3.8.0 — domain rule pack regression tests for retail / gov /
 * education / telecom.
 *
 * Same shape as v340Fixtures.test.ts: per-domain fixture .feature file,
 * three assertions per domain (activated → every step matches;
 * not activated → most steps fall through; all-four-together → cross-
 * cutting no-conflict assertion).
 */

import { afterEach, describe, it, expect } from "vitest";
import * as path from "path";
import { parseFeature } from "../../src/parser/gherkinParser";
import {
  matchStep,
  setActiveDomains,
  type DomainName,
} from "../../src/transformers/stepMatcher";
import type { PageObjectIR } from "../../src/types";

const FIXTURES = path.resolve(__dirname, "..", "fixtures", "v3.8.0");

const EMPTY_POM: PageObjectIR = {
  className: "Page",
  filePath: "pages/page.page.ts",
  fields: [],
  methods: [{ name: "goto", params: [], body: "", origin: "generated" }],
  exists: false,
};

async function probeFixture(
  domain: DomainName,
  activateDomain: boolean,
): Promise<{ matched: number; warnings: string[] }> {
  if (activateDomain) setActiveDomains([domain]);
  else setActiveDomains(undefined);

  const feature = await parseFeature(
    path.join(FIXTURES, domain, "input.feature"),
  );
  let matched = 0;
  const warnings: string[] = [];
  for (const scenario of feature.scenarios) {
    for (const step of scenario.steps) {
      const binding = matchStep(step, EMPTY_POM, "page");
      if (binding.warning) warnings.push(`${step.keyword} ${step.text}`);
      else matched += 1;
    }
  }
  return { matched, warnings };
}

describe("v3.8.0 — domain rule packs (retail / gov / education / telecom)", () => {
  afterEach(() => setActiveDomains(undefined));

  const cases: { domain: DomainName; minMatches: number }[] = [
    { domain: "retail", minMatches: 16 },
    { domain: "gov", minMatches: 16 },
    { domain: "education", minMatches: 16 },
    { domain: "telecom", minMatches: 16 },
  ];

  for (const { domain, minMatches } of cases) {
    it(`activated → every ${domain} fixture step matches a rule`, async () => {
      const { matched, warnings } = await probeFixture(domain, true);
      expect(
        warnings,
        `${domain} fixture had unexpected unmatched steps: ${warnings.join(" | ")}`,
      ).toEqual([]);
      expect(matched).toBeGreaterThanOrEqual(minMatches);
    });

    it(`NOT activated → ${domain} steps fall through (proves opt-in)`, async () => {
      const { warnings } = await probeFixture(domain, false);
      // The vast majority of domain-shaped steps must fall through
      // without the pack active. We allow generic v3.3.x rules to
      // coincidentally catch a couple — insist on at least N-3 of N.
      expect(warnings.length).toBeGreaterThan(8);
    });
  }

  it("all four activated together — no step drops on either side", async () => {
    setActiveDomains(["retail", "gov", "education", "telecom"]);
    for (const { domain } of cases) {
      const feature = await parseFeature(
        path.join(FIXTURES, domain, "input.feature"),
      );
      for (const scenario of feature.scenarios) {
        for (const step of scenario.steps) {
          const binding = matchStep(step, EMPTY_POM, "page");
          expect(
            binding.warning,
            `with all four domains active, ${domain} step "${step.text}" produced a warning`,
          ).toBeUndefined();
        }
      }
    }
  });
});
