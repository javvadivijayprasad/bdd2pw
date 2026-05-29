/**
 * v3.0.0 — API step pattern snapshot tests.
 *
 * For each fixture in `tests/fixtures/api/*.feature`, parse the feature,
 * match every step (rule-only — no LLM), and render the resulting
 * `.spec.ts` via the emitter. Compare byte-for-byte against the matching
 * snapshot in `tests/expected-output/api/`.
 *
 * Snapshot generation: set `BDD2PW_UPDATE_SNAPSHOTS=1` and run the suite.
 * The test writes the actual output to disk instead of comparing. Useful
 * after intentional emitter changes; commit the regenerated snapshots.
 *
 * Also verifies that NO LLM fallback runs on API-shaped steps — the
 * matchStep call short-circuits via the rule registry. If you ever see
 * `step.warning` populated for an API fixture, a rule regressed.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs-extra";
import * as path from "path";
import { parseFeature } from "../../src/parser/gherkinParser";
import { matchStep } from "../../src/transformers/stepMatcher";
import { emitTestFile } from "../../src/emitters/facade";
import type { PageObjectIR, StepBinding } from "../../src/types";

const FIXTURES_DIR = path.resolve(__dirname, "..", "fixtures", "api");
const EXPECTED_DIR = path.resolve(__dirname, "..", "expected-output", "api");
const UPDATE = process.env.BDD2PW_UPDATE_SNAPSHOTS === "1";

/** Empty POM — pure-API fixtures don't reference any page-object fields. */
const EMPTY_POM: PageObjectIR = {
  className: "ApiPage",
  filePath: "pages/api.page.ts",
  fields: [],
  methods: [],
  exists: false,
};

/**
 * POM for the mixed-ui-api fixture — its scenario uses UI steps
 * (`I enter ... into the email field`, `I click the submit button`,
 * `I should see "Thanks!"`) which need real POM fields to resolve. The
 * field names here match exactly what the UI rules expect for the steps
 * in that .feature file.
 */
const MIXED_POM: PageObjectIR = {
  className: "ContactPage",
  filePath: "pages/contact.page.ts",
  fields: [
    {
      api: "getByLabel",
      args: '"Email"',
      fieldName: "emailInput",
      source: { tag: "input", label: "Email" },
      confidence: "unique",
    },
    {
      api: "getByRole",
      args: '"button", { name: "Submit" }',
      fieldName: "submitButton",
      source: { tag: "button", role: "button", name: "Submit" },
      confidence: "unique",
    },
    {
      api: "getByText",
      args: '"Thanks!"',
      fieldName: "thanksBanner",
      source: { tag: "div", text: "Thanks!" },
      confidence: "unique",
    },
  ],
  methods: [{ name: "goto", params: [], body: "", origin: "generated" }],
  exists: false,
};

function pomFor(fixtureName: string): { pom: PageObjectIR; pageVar: string } {
  if (fixtureName === "mixed-ui-api") {
    return { pom: MIXED_POM, pageVar: "contactPage" };
  }
  return { pom: EMPTY_POM, pageVar: "apiPage" };
}

/**
 * Render a parsed FeatureIR through the matcher + emitter. Returns the
 * emitted .spec.ts string. Skips POM imports (pure-API features don't
 * need a POM class).
 */
async function renderFeature(
  featurePath: string,
  fixtureName: string,
): Promise<string> {
  const feature = await parseFeature(featurePath);
  const { pom, pageVar } = pomFor(fixtureName);
  const scenarios = feature.scenarios.map((s) => ({
    name: s.name,
    bindings: s.steps.map<StepBinding>((step) =>
      matchStep(step, pom, pageVar),
    ),
    tags: s.tags,
  }));
  const out = emitTestFile({
    describeName: `Feature: ${feature.name}`,
    scenarios,
    pomImports: [],
  });
  return out.contents;
}

const fixtures = [
  "simple-get",
  "post-with-body",
  "post-with-headers",
  "chained-calls",
  "status-list",
  "body-field-equals",
  "body-regex-match",
  "headers",
  "mixed-ui-api",
];

describe("v3.0.0 — API fixture snapshots", () => {
  for (const name of fixtures) {
    it(`${name}.feature renders to the expected spec`, async () => {
      const featurePath = path.join(FIXTURES_DIR, `${name}.feature`);
      const expectedPath = path.join(EXPECTED_DIR, `${name}.spec.ts`);
      const actual = await renderFeature(featurePath, name);

      if (UPDATE) {
        await fs.ensureDir(EXPECTED_DIR);
        await fs.writeFile(expectedPath, actual, "utf8");
        // Pass the assertion so the test reports green during regen.
        expect(actual).toBeTruthy();
        return;
      }

      const expected = await fs.readFile(expectedPath, "utf8");
      expect(actual).toBe(expected);
    });
  }

  it("no API fixture step falls through to the LLM fallback", async () => {
    // The rule registry should match every step in every API fixture
    // deterministically — none should produce `warning`. If this fails
    // after a rule edit, an API pattern regressed.
    for (const name of fixtures) {
      const feature = await parseFeature(path.join(FIXTURES_DIR, `${name}.feature`));
      const { pom, pageVar } = pomFor(name);
      for (const scenario of feature.scenarios) {
        for (const step of scenario.steps) {
          const binding = matchStep(step, pom, pageVar);
          // mixed-ui-api intentionally has UI steps (`I am on …`,
          // `I enter …`, `I click …`, `I should see …`) which match the
          // UI rules and don't set apiContext — that's fine. The
          // assertion is just "no warning" — every step must match
          // SOMETHING in the rule registry, given a POM that carries
          // the referenced fields (see MIXED_POM above).
          expect(
            binding.warning,
            `${name}.feature step "${step.keyword} ${step.text}" produced a warning instead of a binding`,
          ).toBeUndefined();
        }
      }
    }
  });
});
