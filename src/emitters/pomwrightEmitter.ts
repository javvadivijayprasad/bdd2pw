/**
 * v4.7.0 — POMWright target emitter (PoC per POMWright#63 design
 * discussion with DyHex).
 *
 * Classic emission (the existing `pw-emit` path) produces a Page Object
 * class with `readonly fieldName = page.getBy...` class fields. POMWright
 * is structurally different:
 *
 *   • Class extends `PageObject<Paths>`, where `Paths` is a TypeScript
 *     union of all registered dotted paths.
 *   • Locators are registered inside `defineLocators()` via
 *     `this.add(path).method(...)`, not as class fields.
 *   • The constructor calls `super(page, baseUrl, path)` so navigation
 *     is baked in.
 *   • Tests use POMWright's `test` fixture (extended from
 *     `@playwright/test`) and reach locators via `pom.getNestedLocator(path)`.
 *
 * This file produces the POMWright-shape POM + spec. The hierarchy
 * inferrer (`src/transformers/hierarchyInferrer.ts`) walks each
 * `LocatorChoice` and returns the dotted path; when no stable ancestor
 * is found, the leaf is emitted flat with a `// TODO:` review marker
 * (the explicit fallback DyHex asked for).
 *
 * Scope caveats (per the DyHex reply):
 *   - New-POM only. Existing POMWright POM update/augment is deferred.
 *   - Reusable locator segments (POMWright's full strength) are
 *     emitted as the straight dotted path a first implementation can
 *     produce; shared-segment deduplication across pages is a later
 *     feature.
 *   - `@step()` decoration on methods is not added yet (POMWright
 *     docs call it out as "any async method") — the PoC emits plain
 *     spec bodies without decorators to keep the scope honest.
 */

import type { PageObjectIR, LocatorChoice, StepBinding, ReviewItem } from "../types";
import { inferPomwrightPath, type InferredPath } from "../transformers/hierarchyInferrer";

export interface EmitPomwrightPomInput {
  pom: PageObjectIR;
  /** Baseline URL used in the generated constructor's `super(page, baseUrl, path)` call. */
  baseUrl: string;
  /** URL path (route) the page lives at. Extracted from the scanned URL; the
   *  caller passes the pathname-and-query component. */
  urlPath: string;
  /**
   * v4.7.0 PoC gap #2a. When provided, these `@step()`-decorated methods
   * are appended to the POM class body (before the closing `}`) and
   * `step` is imported from `pomwright`. Produced by `emitPomwrightSpec`
   * when its `stepMethods` option is set.
   */
  methodsAppend?: string;
  /**
   * v4.7.0 PoC gap #1 close-out. When provided, every entry in this
   * map is registered verbatim BEFORE the newly-discovered leaf
   * registrations, and its path is added to the `Paths` union. This
   * is the AUGMENT path's handoff from the POMWright scanner: existing
   * `this.add("path").method(args)` calls parsed from disk are
   * preserved byte-for-byte, and only genuinely-missing paths are
   * added. Key = path, value = `"<api>(<args>)"` ready to interpolate
   * after `this.add("path").`.
   *
   * On overlap (a new scan picked the same path), the EXISTING entry
   * wins — the registered locator reflects human-curated tuning the
   * scanner shouldn't undo. The classic AUGMENT rule in bdd2pw.
   */
  existingRegistrations?: Map<string, string>;
  /**
   * v4.7.0 PoC gap #1 close-out. Any `@step()`-decorated method the
   * POMWright scanner extracted from the existing file. These are
   * emitted verbatim in the method block AFTER any newly-synthesised
   * `methodsAppend` chunks so hand-written helpers survive AUGMENT.
   */
  existingMethods?: Array<{ name: string; body: string }>;
}

export interface EmitPomwrightPomResult {
  contents: string;
  /** For each original field, the inferred POMWright path (so the spec
   *  emitter can translate `pom.usernameInput.fill()` → `pom.getNestedLocator(path).fill()`). */
  pathByFieldName: Map<string, string>;
  warnings: ReviewItem[];
}

/**
 * Render a POMWright-shape Page Object (pom module) from the IR.
 */
export function emitPomwrightPom(input: EmitPomwrightPomInput): EmitPomwrightPomResult {
  const { pom, baseUrl, urlPath } = input;
  const warnings: ReviewItem[] = [];
  const pathByFieldName = new Map<string, string>();

  // 1. Walk every LocatorChoice, infer its hierarchical path.
  //    Collect warnings for flat-fallback cases.
  const inferred: Array<{ choice: LocatorChoice; inf: InferredPath }> = pom.fields.map(
    (choice) => ({ choice, inf: inferPomwrightPath(choice) }),
  );

  // 2. Build the Paths union — deduplicated set of EVERY intermediate
  //    segment in the chain. POMWright requires parents registered too
  //    when `getNestedLocator()` is called, because the chain is built
  //    bottom-up from the registered segments.
  const allPaths = new Set<string>();
  for (const { inf } of inferred) {
    // Walk prefixes of the dotted path so parents are present.
    for (let i = 1; i <= inf.segments.length; i++) {
      allPaths.add(inf.segments.slice(0, i).join("."));
    }
  }
  // v4.7.0 PoC gap #1 — fold in every existing registration's path so
  // AUGMENT's union includes paths the user already wrote.
  if (input.existingRegistrations) {
    for (const p of input.existingRegistrations.keys()) {
      allPaths.add(p);
      // Register parent prefixes too, in case the user wrote just a
      // leaf without the chain (unusual but legal).
      const segs = p.split(".");
      for (let i = 1; i <= segs.length; i++) {
        allPaths.add(segs.slice(0, i).join("."));
      }
    }
  }
  const pathsSorted = [...allPaths].sort();

  // 3. Populate pathByFieldName for the spec emitter.
  for (const { choice, inf } of inferred) {
    pathByFieldName.set(choice.fieldName, inf.path);
    if (inf.reviewNeeded) {
      warnings.push({
        severity: "warn",
        message:
          `POMWright hierarchy fell back to flat for "${choice.fieldName}" — ` +
          `no stable ancestor (main/form/nav/section-with-name) was found in the scanned xpath/CSS. ` +
          `Consider adding an id, aria-label or role to the container, or editing the registered ` +
          `path in the generated POM by hand.`,
      });
    }
  }

  // 4. Emit the class body.
  const lines: string[] = [];
  lines.push(`import { type Page } from "@playwright/test";`);
  const hasNewMethods =
    typeof input.methodsAppend === "string" && input.methodsAppend.length > 0;
  const hasExistingMethods =
    Array.isArray(input.existingMethods) && input.existingMethods.length > 0;
  const needsStepImport = hasNewMethods || hasExistingMethods;
  if (needsStepImport) {
    lines.push(`import { PageObject, step } from "pomwright";`);
  } else {
    lines.push(`import { PageObject } from "pomwright";`);
  }
  lines.push(``);
  lines.push(`type Paths =`);
  for (let i = 0; i < pathsSorted.length; i++) {
    const sep = i === pathsSorted.length - 1 ? ";" : "";
    lines.push(`  | ${JSON.stringify(pathsSorted[i])}${sep}`);
  }
  lines.push(``);
  lines.push(`export class ${pom.className} extends PageObject<Paths> {`);
  lines.push(`  constructor(page: Page) {`);
  lines.push(`    super(page, ${JSON.stringify(baseUrl)}, ${JSON.stringify(urlPath)});`);
  lines.push(`  }`);
  lines.push(``);
  lines.push(`  protected defineLocators(): void {`);

  // Emit INTERMEDIATE ancestor segments first (so the chain parents
  // resolve). Each segment becomes a single registration; POMWright
  // chains them together on `getNestedLocator`.
  // Strategy: for each unique path, register the leaf step only once.
  // The segment's Playwright call: for a leaf locator we have the
  // original `choice.api(args)`; for ancestor segments we synthesise
  // `getByRole(tag, { name })` or `locator(tag)` as best effort.
  const emitted = new Set<string>();
  // Register ancestors in order of depth so the output reads root-first.
  for (const path of pathsSorted) {
    if (emitted.has(path)) continue;
    emitted.add(path);

    // v4.7.0 PoC gap #1 — existing registration wins over a fresh pick
    // for the same path (classic AUGMENT: human-curated tuning stays).
    const existingReg = input.existingRegistrations?.get(path);
    if (existingReg) {
      lines.push(`    this.add(${JSON.stringify(path)}).${existingReg};`);
      continue;
    }

    // Does a leaf LocatorChoice correspond exactly to this path?
    const leafMatch = inferred.find((x) => x.inf.path === path);
    if (leafMatch) {
      const { api, args } = leafMatch.choice;
      lines.push(`    this.add(${JSON.stringify(path)}).${api}(${args});`);
      continue;
    }

    // Ancestor-only segment — synthesise from the last `<tag>@<name>` piece.
    const lastSegment = path.split(".").pop() ?? path;
    const [tag, name] = lastSegment.split("@");
    if (name) {
      // Prefer getByRole when the tag corresponds to an ARIA landmark role.
      const landmarkRole = ARIA_LANDMARK_ROLE[tag];
      if (landmarkRole) {
        lines.push(
          `    this.add(${JSON.stringify(path)}).getByRole(${JSON.stringify(landmarkRole)}, { name: ${JSON.stringify(deCamel(name))} });`,
        );
      } else {
        // Fall back to CSS selector on the tag + name as id/aria-label (best effort).
        lines.push(
          `    this.add(${JSON.stringify(path)}).locator(${JSON.stringify(`${tag}[id="${name}"], ${tag}[aria-label="${deCamel(name)}"], ${tag}[name="${name}"]`)});`,
        );
      }
    } else {
      // Bare landmark (`main`, `nav`, `header`, `footer`, `aside`).
      const landmarkRole = ARIA_LANDMARK_ROLE[tag];
      if (landmarkRole) {
        lines.push(
          `    this.add(${JSON.stringify(path)}).getByRole(${JSON.stringify(landmarkRole)});`,
        );
      } else {
        lines.push(
          `    this.add(${JSON.stringify(path)}).locator(${JSON.stringify(tag)});`,
        );
      }
    }
  }

  lines.push(`  }`);
  if (hasNewMethods) {
    lines.push(``);
    lines.push(input.methodsAppend!);
  }
  // v4.7.0 PoC gap #1 — preserve every @step() method the scanner
  // extracted from the existing file, verbatim, AFTER any freshly
  // synthesised methods. Deduplicates by name: a new methodsAppend
  // entry with the same name as an existing method WINS (freshly
  // regenerated bodies reflect the current scenarios).
  if (hasExistingMethods) {
    const newMethodNames = new Set<string>();
    if (input.methodsAppend) {
      for (const m of input.methodsAppend.matchAll(/async\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
        newMethodNames.add(m[1]);
      }
    }
    for (const em of input.existingMethods!) {
      if (newMethodNames.has(em.name)) continue;
      lines.push(``);
      lines.push(`  @step()`);
      lines.push(`  async ${em.name}(): Promise<void> {`);
      for (const bl of em.body.split("\n")) {
        lines.push(`    ${bl}`);
      }
      lines.push(`  }`);
    }
  }
  lines.push(`}`);
  lines.push(``);

  return {
    contents: lines.join("\n"),
    pathByFieldName,
    warnings,
  };
}

const ARIA_LANDMARK_ROLE: Record<string, string> = {
  main: "main",
  nav: "navigation",
  header: "banner",
  footer: "contentinfo",
  aside: "complementary",
  section: "region",
  form: "form",
  dialog: "dialog",
  table: "table",
  fieldset: "group",
};

/**
 * `userName` → `User Name`, `login` → `Login`. Used to turn a camelCase
 * path-segment name back into something that matches the element's
 * accessible name on the page (best effort).
 */
function deCamel(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

/**
 * Render a POMWright-shape test spec that references the generated POM
 * via POMWright's own `test` fixture.
 *
 * Classic spec: `await loginPage.usernameInput.fill("alice");`
 * POMWright spec: `await loginPage.getNestedLocator("main.form@login.input@username").fill("alice");`
 *
 * The transformer here takes the already-bound `StepBinding[]` from the
 * step matcher and rewrites every `<pageVar>.<fieldName>` reference to
 * the POMWright path form. Bindings the matcher emitted as customBody
 * (compound inputs, N4e list assertions, etc.) are left alone — rewriting
 * arbitrary code is out of scope for the PoC and would be unsound.
 * Only `pomCall` and `assertion.locator` rewrites happen.
 */
export interface EmitPomwrightSpecInput {
  describeName: string;
  pomClassName: string;
  pomVar: string;
  pomImportPath: string;
  scenarios: Array<{
    name: string;
    bindings: StepBinding[];
    tags?: string[];
  }>;
  pathByFieldName: Map<string, string>;
  beforeEach?: StepBinding[];
  /**
   * v4.7.0 PoC gap #2a close-out. When true, emit each scenario's
   * bindings as a POM method decorated with `@step()` (POMWright's own
   * report-step decorator), and have the test call that method instead
   * of inlining `test.step(...)` blocks. The POMWright report then
   * shows one step per scenario rather than one per Gherkin step —
   * matching how a hand-written POMWright suite reads.
   *
   * Default: false (inline `test.step` per binding — v4.7.0.0 shape).
   * Enable via ScaffoldOptions.pomwrightStepMethods === true or the
   * `--pomwright-step-methods` CLI flag.
   */
  stepMethods?: boolean;
  /**
   * v4.7.0 — parity with the classic emitter's v4.6.4 unbound-step
   * defence (attestqa handoff 2026-10-19). Controls what the POMWright
   * emitter writes for a step the matcher couldn't bind:
   *   - "skip" (DEFAULT): if ANY binding in a scenario is TODO, prepend
   *     `test.fixme(true, "bdd2pw: N step(s) not bound: ...")` to the
   *     test body. Playwright reports the test as *skipped* with the
   *     reason instead of silently passing.
   *   - "throw": each TODO step throws `Error("TODO (bdd2pw): ...")`.
   *     Test fails at the unbound step.
   *   - "none": pre-v4.7.0 silent-pass behaviour (empty test.step body).
   */
  todoStepHandling?: "skip" | "throw" | "none";
  /**
   * When `stepMethods` is true, the emitted POM gets a method per
   * scenario; this is the extra content to append to the POM class.
   * The emitter returns it via `pomMethodsAppend` so the caller
   * (index.ts) can re-write the POM file with the method block
   * inserted before the final closing brace.
   */
}

export interface EmitPomwrightSpecResult {
  contents: string;
  warnings: ReviewItem[];
  /**
   * v4.7.0 PoC gap #2a. When `stepMethods` was true in the input,
   * this carries the `@step()` method block to splice into the POM
   * class body (before the closing `}`) so the generated test can
   * call `await loginPage.<scenarioMethod>()` instead of inlining
   * `test.step(...)` calls. Empty when `stepMethods` was false.
   */
  pomMethodsAppend?: string;
}

export function emitPomwrightSpec(
  input: EmitPomwrightSpecInput,
): EmitPomwrightSpecResult {
  const warnings: ReviewItem[] = [];
  const {
    describeName,
    pomClassName,
    pomVar,
    pomImportPath,
    scenarios,
    pathByFieldName,
  } = input;

  // Translate a `<pomVar>.<field>` reference into a
  // `<pomVar>.getNestedLocator("<path>")` reference.
  // Leaves `<pomVar>.page` (the base Page escape hatch) alone.
  const translate = (expr: string): string => {
    // Simple regex rewrite — the PoC. Doesn't handle every TS syntax, but
    // the binding emitter output is predictable enough that this works
    // for the common rule-emitted shapes.
    const escapedVar = pomVar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escapedVar}\\.([A-Za-z_$][\\w$]*)`, "g");
    return expr.replace(re, (_m, field) => {
      // Known POMWright base-class members — leave untouched.
      if (
        field === "page" ||
        field === "getNestedLocator" ||
        field === "getLocatorSchema" ||
        field === "navigation" ||
        field === "sessionStorage"
      ) {
        return _m;
      }
      // POMWright replaces the synthesised `goto()` with its own
      // `navigation.goto()` helper that reads the baseUrl + path given
      // to `super(...)` in the constructor.
      if (field === "goto") return `${pomVar}.navigation.goto`;
      const p = pathByFieldName.get(field);
      if (!p) {
        warnings.push({
          severity: "warn",
          message: `POMWright translation: no path for field "${field}" — left as-is, test may not compile.`,
        });
        return _m;
      }
      return `${pomVar}.getNestedLocator(${JSON.stringify(p)})`;
    });
  };

  // v4.7.0 — match the classic emitter's v4.6.4 default (skip).
  const todoMode = input.todoStepHandling ?? "skip";

  const renderBinding = (b: StepBinding): string => {
    const label = (
      (b.step.keyword ?? "").trim() +
      " " +
      (b.step.text ?? "").trim()
    ).trim();
    const labelLit = JSON.stringify(label || "(empty step)");
    const body: string[] = [];
    if (b.customBody) {
      body.push(...translate(b.customBody).split("\n"));
    } else if (b.pomCall) {
      const args = b.pomCall.args.join(", ");
      body.push(translate(`await ${b.pomCall.page}.${b.pomCall.method}(${args});`));
    } else if (b.assertion) {
      const locator = translate(b.assertion.locator);
      const expected = b.assertion.expected !== undefined ? b.assertion.expected : "";
      body.push(`await expect(${locator}).${b.assertion.matcher}(${expected});`);
    } else {
      // v4.7.0 — attestqa-handoff defence parity with the classic path.
      // "throw" raises an error so the test fails at the unbound step;
      // "skip" / "none" leave a TODO comment (skip short-circuits via
      // the test.fixme at the top of the test; none accepts silent pass).
      const safeWarning = (b.warning ?? "no rule matched this step").replace(
        /\r?\n/g,
        " ",
      );
      if (todoMode === "throw") {
        body.push(
          `throw new Error(${JSON.stringify(`TODO (bdd2pw): step not implemented — ${safeWarning}`)});`,
        );
      } else {
        body.push(`// TODO: ${safeWarning}`);
      }
    }
    return (
      `  await test.step(${labelLit}, async () => {\n` +
      body.map((l) => `    ${l}`).join("\n") +
      `\n  });`
    );
  };

  // v4.7.0 PoC gap #2a. When stepMethods is on, each scenario's
  // binding body becomes a method on the POM, decorated with @step()
  // from POMWright. The test then calls that method instead of
  // inlining `test.step(...)` per Gherkin step.
  const stepMethods = input.stepMethods === true;
  const pomMethodChunks: string[] = [];
  const methodNameFor = (scenarioName: string): string => {
    const safe = scenarioName
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .map((w, i) =>
        i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
      )
      .join("");
    return `scenario${safe.charAt(0).toUpperCase()}${safe.slice(1)}` || "scenario";
  };

  const lines: string[] = [];
  lines.push(`import { expect } from "@playwright/test";`);
  lines.push(`import { test as base } from "pomwright";`);
  lines.push(`import { ${pomClassName} } from "${pomImportPath}";`);
  lines.push(``);
  lines.push(`const test = base.extend<{ ${pomVar}: ${pomClassName} }>({`);
  lines.push(`  ${pomVar}: async ({ page }, use) => {`);
  lines.push(`    await use(new ${pomClassName}(page));`);
  lines.push(`  },`);
  lines.push(`});`);
  lines.push(``);
  lines.push(`test.describe(${JSON.stringify(describeName)}, () => {`);
  if (input.beforeEach && input.beforeEach.length) {
    lines.push(`  test.beforeEach(async ({ ${pomVar} }) => {`);
    for (const b of input.beforeEach) {
      lines.push(renderBinding(b).replace(/^ {2}/gm, "    "));
    }
    lines.push(`  });`);
    lines.push(``);
  }
  for (const s of scenarios) {
    if (s.tags) for (const t of s.tags) lines.push(`  // ${t}`);
    lines.push(`  test(${JSON.stringify(s.name)}, async ({ ${pomVar} }) => {`);
    // v4.7.0 — parity with the classic emitter's v4.6.4 unbound-step
    // defence (attestqa handoff 2026-10-19 — silent pass is wrong).
    // If any binding is TODO, prepend test.fixme so Playwright reports
    // the test as skipped rather than silently passed. The step-methods
    // branch is unaffected (the method body contains the TODOs there).
    if (todoMode === "skip") {
      const todoBindings = s.bindings.filter(
        (b) => !b.customBody && !b.pomCall && !b.assertion,
      );
      if (todoBindings.length > 0) {
        const titles = todoBindings
          .slice(0, 3)
          .map((b) => {
            const kw = (b.step.keyword ?? "").trim();
            const tx = (b.step.text ?? "").trim();
            return (kw ? `${kw} ${tx}` : tx).trim();
          })
          .join(" | ");
        const more = todoBindings.length > 3 ? ` (+${todoBindings.length - 3} more)` : "";
        const reason = `bdd2pw: ${todoBindings.length} step(s) not bound — ${titles}${more}`;
        lines.push(
          `    test.fixme(true, ${JSON.stringify(reason.replace(/\r?\n/g, " "))});`,
        );
      }
    }
    if (stepMethods) {
      // Call the POM method; the method itself carries @step() so the
      // Playwright report viewer shows one row per scenario.
      const m = methodNameFor(s.name);
      lines.push(`    await ${pomVar}.${m}();`);
      // Collect the method body for the POM-append output. Inside the
      // POM class method body, references to the page-object variable
      // (`loginPage`) should become `this`; the method body translator
      // rewrites `<pomVar>.<x>` → `this.<x>` for every rewrite the spec
      // translator does for `<pomVar>.<x>` → `<pomVar>.getNestedLocator(...)`.
      const translateInsideMethod = makeInsideMethodTranslator(
        pomVar,
        pathByFieldName,
        warnings,
      );
      const bodyLines: string[] = [];
      for (const b of s.bindings) {
        const translated = renderBindingBodyOnly(b, pomVar, translateInsideMethod);
        for (const l of translated.split("\n")) bodyLines.push(`    ${l}`);
      }
      pomMethodChunks.push(
        `  @step()\n  async ${m}(): Promise<void> {\n${bodyLines.join("\n")}\n  }`,
      );
    } else {
      for (const b of s.bindings) {
        lines.push(renderBinding(b).replace(/^ {2}/gm, "    "));
      }
    }
    lines.push(`  });`);
    lines.push(``);
  }
  lines.push(`});`);

  const result: EmitPomwrightSpecResult = { contents: lines.join("\n"), warnings };
  if (stepMethods && pomMethodChunks.length > 0) {
    result.pomMethodsAppend = pomMethodChunks.join("\n\n");
  }
  return result;
}

/**
 * v4.7.0 PoC gap #2a. Translator variant for use INSIDE a POM class
 * method body. Rewrites `<pomVar>.<field>` references to `this.<field>`
 * equivalents, so the emitted code is valid inside the class:
 *
 *   loginPage.usernameInput.fill("x")                 (spec context)
 *   → this.getNestedLocator("main.form@login.input@username").fill("x")  (method body)
 *
 *   loginPage.goto()        → this.navigation.goto()
 *   loginPage.page          → this.page
 *   loginPage.navigation    → this.navigation
 */
function makeInsideMethodTranslator(
  pomVar: string,
  pathByFieldName: Map<string, string>,
  warnings: ReviewItem[],
): (expr: string) => string {
  const escapedVar = pomVar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${escapedVar}\\.([A-Za-z_$][\\w$]*)`, "g");
  return (expr: string): string =>
    expr.replace(re, (_m, field) => {
      if (
        field === "page" ||
        field === "getNestedLocator" ||
        field === "getLocatorSchema" ||
        field === "navigation" ||
        field === "sessionStorage"
      ) {
        return `this.${field}`;
      }
      if (field === "goto") return `this.navigation.goto`;
      const p = pathByFieldName.get(field);
      if (!p) {
        warnings.push({
          severity: "warn",
          message: `POMWright translation (inside method): no path for field "${field}" — left as-is, test may not compile.`,
        });
        return _m;
      }
      return `this.getNestedLocator(${JSON.stringify(p)})`;
    });
}

/**
 * Render a binding as pure statements (no `test.step` wrapper) — used by
 * the @step()-decorated method body. Mirrors renderBinding minus the
 * step wrapper and label line.
 */
function renderBindingBodyOnly(
  b: StepBinding,
  pomVar: string,
  translate: (s: string) => string,
): string {
  if (b.customBody) return translate(b.customBody);
  if (b.pomCall) {
    const args = b.pomCall.args.join(", ");
    return translate(`await ${b.pomCall.page}.${b.pomCall.method}(${args});`);
  }
  if (b.assertion) {
    const locator = translate(b.assertion.locator);
    const expected = b.assertion.expected !== undefined ? b.assertion.expected : "";
    return `await expect(${locator}).${b.assertion.matcher}(${expected});`;
  }
  return `// TODO: ${b.warning ?? "no rule matched this step"}`;
}
