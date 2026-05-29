/**
 * Thin facade over `@vijaypjavvadi/pw-emit`. All POM/spec rendering happens
 * in `pw-emit`; bdd2pw only owns:
 *   - the orchestration (which IRs to feed in, in what order)
 *   - the IR→pw-emit adaptation (bdd2pw's IR carries scaffolder-only fields
 *     like `filePath` and `exists` that pw-emit doesn't need)
 *
 * See docs/PHASE_0_PLAN.md and docs/ARCHITECTURE.md §5.
 */

import {
  emitPageObject as pwEmitPageObject,
  emitTestSpec as pwEmitTestSpec,
  type PageObjectIR as PwPageObjectIR,
  type LocatorChoice as PwLocatorChoice,
  type TestSpecIR,
  type EmitResult,
  type EmitPageObjectOptions,
} from "@vijaypjavvadi/pw-emit";

import type {
  PageObjectIR,
  LocatorChoice,
  StepBinding,
  ReviewItem,
} from "../types";
import { camelCase } from "../utils/naming";
import { flattenForComment } from "../utils/commentSafe";

/**
 * v2.2.5 — BUG-9 safety net.
 *
 * If a cached LLM binding from v2.2.4 or earlier references a POM field
 * whose name starts with a digit (e.g. `r0c934ddf001.0Of0` from
 * juice-shop's "0 of 0" pagination label), we rewrite the
 * digit-leading segment to be `_`-prefixed so the spec parses.
 *
 * The v2.2.5 field-name synthesiser already prevents new bindings from
 * having this shape, but cached entries persist across versions until
 * explicitly cleared.
 *
 * Patterns rewritten:
 *   `foo.0Of0`       → `foo._0Of0`           // member access onto digit
 *   `foo[0Of0]`      → `foo[_0Of0]`          // computed-property identifier
 *   `foo.0,0Of0`     → `foo._0_0Of0`         // commas → underscore
 */
export function sanitizeLocatorReferences(s: string): string {
  if (!s) return s;
  // 1. `.<digit>` → `._<digit>` for member access
  let out = s.replace(/(\.)([0-9][A-Za-z0-9_$,]*)/g, (_, dot, ident) => {
    return dot + "_" + ident.replace(/,/g, "_");
  });
  // 2. Strip stray commas from identifier-shaped runs after a dot we
  //    already prefixed (handled above) and from bracket-property names.
  out = out.replace(/\[([0-9][A-Za-z0-9_$,]*)\]/g, (_, ident) => {
    return "[_" + ident.replace(/,/g, "_") + "]";
  });
  return out;
}

export class EmitterConsistencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmitterConsistencyError";
  }
}

export interface EmitPageObjectInput {
  pom: PageObjectIR;
  /** When `'augment'`, an existing file is being updated — caller must
   *  ensure the IR already contains both existing and new fields/methods.
   *  See FR-19 in docs/SCOPE.md. */
  mode: "create" | "augment";
  existing?: string;
  /** Wrap locator initialisers in `healOrThrow(...)` for runtime healing. */
  selfHealingShim?: boolean;
}

export interface EmitTestFileInput {
  describeName: string;
  beforeEach?: StepBinding[];
  scenarios: {
    name: string;
    bindings: StepBinding[];
    /** v3.0.0 — scenario tags (`@api`, `@ui`, `@positive`, etc.). The
     *  renderer reads `@api` / `@ui` to decide goto-suppression behavior
     *  and to thread tags through to the emitted `// @tag` comments. */
    tags?: string[];
  }[];
  pomImports: { className: string; fromPath: string }[];
  /**
   * v3.1.0 — opt-in step hook callouts. When true, every `test.step` body
   * is wrapped in `await (globalThis as any).__bdd2pwHooks?.beforeStep?.(...)`
   * and `?.afterStep?.(...)` calls. Consumers (e.g. TestForge VR capture)
   * can set the global hook to instrument every step; consumers who don't
   * see optional-chained no-ops. See TestForge handoff Issue 4.
   */
  stepHooks?: boolean;
  /**
   * v3.1.0 — opt-in step boundary markers. When true, each `test.step` is
   * bracketed by `// bdd2pw:step-open id="NNNN" title="..."` and
   * `// bdd2pw:step-close id="NNNN"` comments. Lets post-processors
   * slice the source on stable strings instead of brace counting.
   * See TestForge handoff Issue 5.
   */
  stepMarkers?: boolean;
}

export type { EmitResult };

/**
 * Adapt a bdd2pw `LocatorChoice` to a pw-emit `LocatorChoice`.
 * Drops scaffolder-only fields (`source`, `confidence`).
 */
function toPwLocatorChoice(c: LocatorChoice): PwLocatorChoice {
  return { api: c.api, args: c.args, fieldName: c.fieldName };
}

/**
 * Adapt a bdd2pw `PageObjectIR` to a pw-emit `PageObjectIR`.
 * Drops scaffolder-only fields (`filePath`, `url`, `exists`); converts
 * methods (which already carry pre-rendered TS bodies in bdd2pw).
 */
function toPwPageObjectIR(pom: PageObjectIR): PwPageObjectIR {
  return {
    className: pom.className,
    fields: pom.fields.map(toPwLocatorChoice),
    methods: pom.methods.map((m) => ({
      name: m.name,
      params: m.params,
      body: m.body,
    })),
  };
}

export function emitPageObject(input: EmitPageObjectInput): EmitResult {
  if (input.mode === "augment" && !input.existing) {
    throw new EmitterConsistencyError(
      `emitPageObject(mode: 'augment') requires the existing file contents — caller must read the file first.`,
    );
  }
  const opts: EmitPageObjectOptions = { selfHealingShim: input.selfHealingShim };
  return pwEmitPageObject(toPwPageObjectIR(input.pom), opts);
}

/**
 * Render a Gherkin-derived test spec via pw-emit.
 *
 * The bdd2pw caller passes `StepBinding[]` per scenario (still tied to
 * Gherkin step text + POM method calls); the facade renders them into TS
 * body strings and hands the resulting `TestSpecIR` to pw-emit.
 *
 * **POM instantiation:** every test body and every hook body is prefixed
 * with `const <pageVar> = new <ClassName>(page);` for each imported POM.
 * Without this, `await loginPage.goto()` references an undeclared variable.
 * Each scope gets its own fresh instance — POM construction is just
 * Locator creation, which is cheap.
 */
export function emitTestFile(input: EmitTestFileInput): EmitResult {
  const prelude = input.pomImports.map(
    (p) => `const ${camelCase(p.className)} = new ${p.className}(page);`,
  );

  // v3.0.0 — detect API content. A scenario is API-bearing when at least
  // one of its bindings carries `apiContext: true`. We use this signal
  // for three things:
  //   1. Per-test reset (`apiResponse = null;`) prepended to the body.
  //   2. Describe-scoped state declarations + APIResponse import.
  //   3. Tracking the last request for the "previous request again" rule.
  const scenariosWithApiFlag = input.scenarios.map((s) => ({
    ...s,
    hasApi: s.bindings.some((b) => b.apiContext === true),
  }));
  const featureHasApi = scenariosWithApiFlag.some((s) => s.hasApi);

  // v3.3.0 — fixtures destructured by the emitted `test(...)` callback.
  // Forwarded into the step hooks so consumers can take per-step
  // screenshots / save DOM / etc. without re-resolving fixtures.
  // Defaults to `["page"]` — matches pw-emit's testEmitter default.
  const defaultFixtures = ["page"];
  const stepOpts = {
    stepHooks: input.stepHooks === true,
    stepMarkers: input.stepMarkers === true,
    fixtures: defaultFixtures,
  };
  const ir: TestSpecIR = {
    describeName: input.describeName,
    pomImports: input.pomImports,
    beforeEach:
      input.beforeEach && input.beforeEach.length
        ? [{ body: bindingsToBody(input.beforeEach, prelude, stepOpts) }]
        : undefined,
    tests: scenariosWithApiFlag.map((s) => {
      const baseBody = bindingsToBody(s.bindings, prelude, stepOpts);
      // Prepend `apiResponse = null;` per the v3.0.0 spec: per-test reset
      // so a leftover from a previous test never bleeds into the next.
      // Only when this scenario actually has API steps — UI-only scenarios
      // in the same feature stay clean.
      const body = s.hasApi
        ? `apiResponse = null;\n${baseBody}`
        : baseBody;
      return {
        name: s.name,
        body,
        tags: s.tags,
      };
    }),
    // Add `type APIResponse` to the @playwright/test import only when at
    // least one scenario uses API steps. Pure-UI features stay unchanged.
    playwrightImports: featureHasApi ? ["type APIResponse"] : undefined,
    describeBodyPrelude: featureHasApi
      ? [
          `let apiResponse: APIResponse | null = null;`,
          `let baseUrl: string = process.env.CLOUD_JOB_APP_URL ?? "";`,
          // _lastApiReq backs the "previous request again with header"
          // rule (API:05). Declared even when only one request rule is
          // used — TypeScript is happy with an unused variable and the
          // alternative (conditionally declare) bloats the analysis.
          `let _lastApiReq: { method: string; path: string; data?: unknown; headers?: Record<string, string> } = { method: "", path: "" };`,
        ].join("\n")
      : undefined,
  };
  return pwEmitTestSpec(ir);
}

/**
 * Render a list of step bindings into a sequence of TS statements wrapped
 * in `await test.step(...)` blocks.
 *
 * Each binding becomes:
 *   await test.step("<keyword> <text>", async () => {
 *     <body>           // POM call, assertion, customBody, or TODO comment
 *   });
 *
 * Why test.step?  Playwright's JSON reporter emits one entry per
 * test.step() call, with `error` populated when that step fails. This is
 * what gives the downstream Scenarios tab honest per-step PASS/FAIL/SKIPPED
 * reporting (v2.1.0 — "Scenarios tab honesty").
 *
 * Unmatched steps (TODO bindings — no rule matched the Gherkin step) are
 * marked by prefixing the step name with "[SKIPPED] ". The body is
 * intentionally a no-op (just a `// TODO:` comment) so Playwright reports
 * the step as passed; pw-to-cucumber.js detects the prefix and rewrites
 * the cucumber.json status to `skipped`. This keeps customers from
 * seeing a green PASS when in reality 4 of the 6 steps did nothing.
 *
 * `prelude` lines (POM instantiation) are emitted at the top OUTSIDE any
 * test.step wrapper — they're scaffolding, not part of the user's
 * Gherkin scenario.
 */
function bindingsToBody(
  bindings: StepBinding[],
  prelude: string[] = [],
  options: {
    stepHooks?: boolean;
    stepMarkers?: boolean;
    /**
     * v3.3.0 — names of the Playwright fixtures destructured in the
     * surrounding `test(...)` callback (`["page"]`, `["page", "request"]`,
     * etc.). When `stepHooks` is on, these get forwarded to the
     * `beforeStep` / `afterStep` callbacks as a `{ page, request, ... }`
     * literal so hooks can take screenshots, save DOM snapshots, etc.
     * Defaults to `["page"]`.
     */
    fixtures?: string[];
  } = {},
): string {
  const fixtureNames =
    options.fixtures && options.fixtures.length > 0 ? options.fixtures : ["page"];
  const fixturesLit = `{ ${fixtureNames.join(", ")} }`;
  const lines: string[] = [];
  if (prelude.length > 0) {
    lines.push(...prelude);
    lines.push("");
  }
  let stepIndex = 0;
  for (const b of bindings) {
    const isTodo = !b.customBody && !b.pomCall && !b.assertion;
    const keyword = (b.step.keyword ?? "").trim();
    const text = (b.step.text ?? "").trim();
    const rawLabel = (keyword ? `${keyword} ${text}` : text).trim() || "(empty step)";
    const stepLabel = isTodo ? `[SKIPPED] ${rawLabel}` : rawLabel;
    // JSON.stringify takes care of escaping quotes, backslashes and
    // newlines safely for embedding in a JS string literal.
    const labelLit = JSON.stringify(stepLabel);

    // v3.1.0 — opt-in stable step-boundary markers (TestForge Issue 5).
    // Zero-padded 4-digit ids per test, in source order. The markers are
    // comment-only — zero runtime cost — and let post-processors slice
    // the source without brace counting.
    stepIndex += 1;
    const stepId = String(stepIndex).padStart(4, "0");
    if (options.stepMarkers) {
      lines.push(
        `// bdd2pw:step-open id="${stepId}" title=${JSON.stringify(stepLabel)}`,
      );
    }

    lines.push(`await test.step(${labelLit}, async () => {`);

    // Collect the step body into a buffer. When stepHooks is on, the
    // buffer is wrapped in try/catch/finally below; otherwise it's
    // emitted directly inside the test.step arrow.
    const bodyLines: string[] = [];
    if (b.customBody) {
      // Compound step — body has multiple statements pre-rendered.
      // v2.2.5 — sanitize digit-leading POM references that may have been
      // cached from older bdd2pw versions.
      const safeBody = sanitizeLocatorReferences(b.customBody);
      for (const line of safeBody.split("\n")) bodyLines.push(line);
    } else if (b.pomCall) {
      const args = b.pomCall.args
        .map((a) => sanitizeLocatorReferences(a))
        .join(", ");
      const method = sanitizeLocatorReferences(b.pomCall.method);
      bodyLines.push(`await ${b.pomCall.page}.${method}(${args});`);
    } else if (b.assertion) {
      const expected =
        b.assertion.expected !== undefined ? b.assertion.expected : "";
      // v2.2.4 — defend against empty/missing locator. The v2.2.3 prompt
      // told the LLM to use empty string for toHaveURL; the LLM took it
      // literally and emitted locator: "". `expect()` with no argument
      // throws TypeError at runtime. Substitute `page` (always in scope
      // inside test bodies because the Playwright fixture is
      // async ({ page }) => ...) when the locator is empty/whitespace.
      const rawLocator = b.assertion.locator;
      const trimmedLocator = (rawLocator == null ? "" : String(rawLocator)).trim();
      // v2.2.5 — rewrite `.0Of0` → `._0Of0` for cached bindings.
      const safeLocator = sanitizeLocatorReferences(trimmedLocator);
      const renderedLocator = safeLocator === "" ? "page" : safeLocator;
      bodyLines.push(
        `await expect(${renderedLocator}).${b.assertion.matcher}(${expected});`,
      );
    } else {
      // v2.0.1 — defensively flatten the warning so any newlines in error
      // messages (e.g. multi-line stack traces from LLM provider errors,
      // native module load failures) don't bleed past the `//` and break
      // the .spec.ts parse.
      const safeWarning = flattenForComment(
        b.warning ?? "no rule matched this step",
      );
      bodyLines.push(`// TODO: ${safeWarning}`);
    }

    // v3.1.0 + v3.3.0 — opt-in step hook callouts. v3.3.0 extends the
    // signature with two new positional args:
    //   - `status: "passed" | "failed"` on afterStep (so consumers can
    //     attach failure-only artefacts).
    //   - `fixtures: { page, request?, context?, browser? }` on both
    //     (so consumers can take per-step screenshots, save DOM
    //     snapshots, etc. without re-resolving fixtures).
    //
    // The body is wrapped in try/catch/finally so afterStep fires on
    // the failure path too. `_bdd2pwStatus` is local to this arrow —
    // no cross-step shadowing.
    //
    // Optional chaining throughout means consumers who don't set
    // `(globalThis as any).__bdd2pwHooks = {...}` see zero behaviour
    // change. Existing v3.1/3.2 hooks that ignore the new positional
    // args continue to work — JS silently drops the extras.
    if (options.stepHooks) {
      lines.push(
        `  await (globalThis as any).__bdd2pwHooks?.beforeStep?.(testInfo, ${labelLit}, ${fixturesLit});`,
      );
      lines.push(`  let _bdd2pwStatus: "passed" | "failed" = "passed";`);
      lines.push(`  try {`);
      for (const bl of bodyLines) lines.push(`    ${bl}`);
      lines.push(`  } catch (_bdd2pwErr) {`);
      lines.push(`    _bdd2pwStatus = "failed";`);
      lines.push(`    throw _bdd2pwErr;`);
      lines.push(`  } finally {`);
      lines.push(
        `    await (globalThis as any).__bdd2pwHooks?.afterStep?.(testInfo, ${labelLit}, _bdd2pwStatus, ${fixturesLit});`,
      );
      lines.push(`  }`);
    } else {
      for (const bl of bodyLines) lines.push(`  ${bl}`);
    }
    lines.push(`});`);
    if (options.stepMarkers) {
      lines.push(`// bdd2pw:step-close id="${stepId}"`);
    }
    lines.push("");
  }
  // Trim trailing blank
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}
