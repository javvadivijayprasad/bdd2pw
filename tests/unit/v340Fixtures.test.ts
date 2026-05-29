/**
 * v3.4.0 — domain rule pack regression tests.
 *
 * Each domain pack has a fixture .feature in
 * `tests/fixtures/v3.4.0/<domain>/input.feature`. The test:
 *   1. Activates the matching domain via setActiveDomains.
 *   2. Parses the feature.
 *   3. Asserts every step matches a rule (no `warning` bindings).
 *   4. Restores activeDomainRules to empty so the cross-cutting
 *      "no domain → byte-stable" assertion still holds.
 *
 * Also verifies that WITHOUT setActiveDomains, the same fixture
 * steps fall to TODO — proving the rules are genuinely opt-in.
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

const FIXTURES = path.resolve(__dirname, "..", "fixtures", "v3.4.0");

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
      if (binding.warning) {
        warnings.push(`${step.keyword} ${step.text}`);
      } else {
        matched += 1;
      }
    }
  }
  return { matched, warnings };
}

describe("v3.4.0 — domain rule packs", () => {
  afterEach(() => {
    // Always reset so other test files aren't polluted by leftover
    // active domains. v3.4.0 contract: domains are per-scaffold() call.
    setActiveDomains(undefined);
  });

  const cases: { domain: DomainName; minMatches: number }[] = [
    { domain: "banking", minMatches: 16 },
    { domain: "healthcare", minMatches: 15 },
    { domain: "insurance", minMatches: 18 },
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
      // Without activation, all domain-specific steps should land as
      // warnings (they're shape-distinct from any v3.3.0 generic rule).
      // We don't insist on ALL — some generic patterns may coincidentally
      // match. Insist on a healthy majority falling through.
      expect(warnings.length).toBeGreaterThan(5);
    });
  }

  it("multiple domains additively activated", async () => {
    setActiveDomains(["banking", "healthcare", "insurance"]);
    for (const { domain } of cases) {
      const feature = await parseFeature(
        path.join(FIXTURES, domain, "input.feature"),
      );
      for (const scenario of feature.scenarios) {
        for (const step of scenario.steps) {
          const binding = matchStep(step, EMPTY_POM, "page");
          expect(
            binding.warning,
            `with all 3 domains active, ${domain} step "${step.text}" still produced a warning`,
          ).toBeUndefined();
        }
      }
    }
  });
});
